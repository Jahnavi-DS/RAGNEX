// SERVER-ONLY MODULE.
//
// TigerGraph/Savanna REST++ client. Reads credentials from the server
// process environment only. This file must never be imported from
// client-rendered code — it is only reachable via
// src/server/retrieval/graph-retriever.ts, which itself is only called
// from src/server/approaches/graphrag.ts, invoked through the TanStack
// Start server function in src/functions/run-graphrag.ts.
//
// INTEGRATION METHOD (see README/report for the research behind this):
// TigerGraph Savanna exposes REST++ on port 443 at
// `<host>/restpp/<endpoint>`. Authentication is OAuth2-style:
//   1. A secret (created once in the Admin Portal / User Management) is
//      exchanged for a bearer token via `POST /gsql/v1/tokens` (the
//      TigerGraph 4.x/Savanna token endpoint — the older
//      `/restpp/requesttoken` endpoint returns HTTP 400 on 4.x/Savanna).
//      The token response shape varies by deployment: the token/expiration
//      may be top-level (`body.token` / `body.expiration`) or nested under
//      `body.results` (`body.results.token` / `body.results.expiration`).
//   2. That token is sent as `Authorization: Bearer <token>` on every
//      subsequent REST++ call.
// Graph traversal is performed via a GSQL installed query invoked at
// `/restpp/query/<graphName>/<queryName>`. This client does not invent or
// guess endpoint behavior beyond what TigerGraph's own docs specify.

export class TigerGraphConfigError extends Error {
  constructor(message = "TigerGraph/Savanna is not configured.") {
    super(message);
    this.name = "TigerGraphConfigError";
  }
}

export class TigerGraphAuthError extends Error {
  constructor(message = "TigerGraph/Savanna authentication failed.") {
    super(message);
    this.name = "TigerGraphAuthError";
  }
}

export class TigerGraphRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerGraphRequestError";
  }
}

type TigerGraphConfig = {
  host: string;
  graphName: string;
  token?: string | undefined;
  secret?: string | undefined;
  tokenLifetimeSeconds: string;
  queryName: string;
};

function readConfig(): TigerGraphConfig | null {
  const host = process.env["TIGERGRAPH_HOST"]?.trim().replace(/\/+$/, "");
  const graphName = process.env["TIGERGRAPH_GRAPH_NAME"]?.trim();
  const token = process.env["TIGERGRAPH_TOKEN"]?.trim() || undefined;
  const secret = process.env["TIGERGRAPH_SECRET"]?.trim() || undefined;
  const tokenLifetimeSeconds =
    process.env["TIGERGRAPH_TOKEN_LIFETIME_SECONDS"]?.trim() || "2592000";
  const queryName = process.env["TIGERGRAPH_QUERY_NAME"]?.trim() || "entity_neighborhood";

  if (!host || !graphName || (!token && !secret)) return null;
  return { host, graphName, token, secret, tokenLifetimeSeconds, queryName };
}

/** True when the minimum required TigerGraph/Savanna env vars are present. */
export function isTigerGraphConfigured(): boolean {
  return readConfig() !== null;
}

export function getConfiguredQueryName(): string {
  return readConfig()?.queryName ?? "entity_neighborhood";
}

function getConfigOrThrow(): TigerGraphConfig {
  const config = readConfig();
  if (!config) {
    throw new TigerGraphConfigError(
      "TigerGraph/Savanna is not configured. Set TIGERGRAPH_HOST and TIGERGRAPH_GRAPH_NAME, plus either TIGERGRAPH_TOKEN or TIGERGRAPH_SECRET.",
    );
  }
  return config;
}

let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function requestToken(config: TigerGraphConfig): Promise<string> {
  if (!config.secret) {
    throw new TigerGraphConfigError(
      "TIGERGRAPH_SECRET is required to request a token when TIGERGRAPH_TOKEN is not set.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${config.host}/gsql/v1/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.secret,
        graph: config.graphName,
        lifetime: config.tokenLifetimeSeconds,
      }),
    });
  } catch (error) {
    throw new TigerGraphRequestError(
      error instanceof Error
        ? `Failed to reach TigerGraph/Savanna: ${error.message}`
        : "Failed to reach TigerGraph/Savanna.",
    );
  }

  const body = (await response.json().catch(() => null)) as {
    error?: boolean;
    message?: string;
    token?: string;
    expiration?: number | string;
    results?: { token?: string; expiration?: number | string };
  } | null;

  // TigerGraph 4.x/Savanna's /gsql/v1/tokens response has been observed both
  // with the token/expiration at the top level and nested under `results` —
  // accept either shape rather than assuming one.
  const token = body?.token ?? body?.results?.token;
  const expiration = body?.expiration ?? body?.results?.expiration;

  if (!response.ok || !body || body.error || !token) {
    throw new TigerGraphAuthError(
      body?.message || `TigerGraph/Savanna token request failed (HTTP ${response.status}).`,
    );
  }

  const parsedExpiration =
    typeof expiration === "number"
      ? expiration * 1000
      : typeof expiration === "string"
        ? /^\d+$/.test(expiration)
          ? Number(expiration) * 1000
          : Date.parse(expiration)
        : Number.NaN;
  const expiresAtMs = Number.isFinite(parsedExpiration)
    ? parsedExpiration
    : Date.now() + Number(config.tokenLifetimeSeconds) * 1000;
  return (cachedToken = { value: token, expiresAtMs }).value;
}

let pendingToken: Promise<string> | null = null;

async function getAuthToken(config: TigerGraphConfig): Promise<string> {
  if (config.token) return config.token;
  // Refresh 60s before expiry to avoid racing an in-flight request against expiration.
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > Date.now()) return cachedToken.value;
  if (!pendingToken) {
    pendingToken = requestToken(config).finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

type RestppEnvelope<T> = {
  error?: boolean;
  message?: string;
  results?: T;
};

async function restRequest<T>(path: string, config: TigerGraphConfig): Promise<T> {
  const token = await getAuthToken(config);

  let response: Response;
  try {
    response = await fetch(`${config.host}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (error) {
    throw new TigerGraphRequestError(
      error instanceof Error
        ? `Failed to reach TigerGraph/Savanna: ${error.message}`
        : "Failed to reach TigerGraph/Savanna.",
    );
  }

  const body = (await response.json().catch(() => null)) as RestppEnvelope<T> | null;

  if (response.status === 401 || response.status === 403) {
    throw new TigerGraphAuthError(body?.message || "TigerGraph/Savanna rejected the credentials.");
  }
  if (!response.ok || !body || body.error) {
    throw new TigerGraphRequestError(
      body?.message || `TigerGraph/Savanna request failed (HTTP ${response.status}).`,
    );
  }
  if (body.results === undefined) {
    throw new TigerGraphRequestError("TigerGraph/Savanna returned no results payload.");
  }
  return body.results;
}

/**
 * Invokes a GSQL installed query via REST++:
 * GET /restpp/query/<graphName>/<queryName>?param=value...
 *
 * The query itself (schema, parameters, return shape) must already be
 * installed on the target graph — this client does not create or install
 * queries. See src/server/retrieval/graph-retriever.ts for the expected
 * query contract.
 */
export async function runInstalledQuery<T = unknown>(
  queryName: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const config = getConfigOrThrow();
  const search = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const results = await restRequest<T[]>(
    `/restpp/query/${config.graphName}/${queryName}?${search.toString()}`,
    config,
  );
  return Array.isArray(results) ? results : [results];
}

/** Reads existing vertices without changing graph data. */
export async function getVertices<T = unknown>(vertexType: string): Promise<T[]> {
  const config = getConfigOrThrow();
  const search = new URLSearchParams({ limit: "1000" });
  const results = await restRequest<T[]>(
    `/restpp/graph/${encodeURIComponent(config.graphName)}/vertices/${encodeURIComponent(vertexType)}?${search.toString()}`,
    config,
  );
  return Array.isArray(results) ? results : [results];
}

/** Looks up existing vertices by an exact attribute value using REST++ server-side filtering. */
export async function getVerticesByAttribute<T = unknown>(
  vertexType: string,
  attribute: string,
  value: string,
): Promise<T[]> {
  const config = getConfigOrThrow();
  const search = new URLSearchParams({
    filter_by: `${attribute},eq,${value}`,
    limit: "100",
  });
  const results = await restRequest<T[]>(
    `/restpp/graph/${encodeURIComponent(config.graphName)}/vertices/${encodeURIComponent(vertexType)}?${search.toString()}`,
    config,
  );
  return Array.isArray(results) ? results : [results];
}

/** Reads one existing vertex by its TigerGraph ID. */
export async function getVertex<T = unknown>(
  vertexType: string,
  vertexId: string,
): Promise<T | null> {
  const config = getConfigOrThrow();
  const results = await restRequest<T | T[]>(
    `/restpp/graph/${encodeURIComponent(config.graphName)}/vertices/${encodeURIComponent(vertexType)}/${encodeURIComponent(vertexId)}`,
    config,
  );
  return Array.isArray(results) ? (results[0] ?? null) : results;
}

/** Reads existing adjacency edges from one vertex, optionally narrowed by schema type. */
export async function getEdges<T = unknown>(
  vertexType: string,
  vertexId: string,
  targetType?: string,
  edgeType?: string,
): Promise<T[]> {
  const config = getConfigOrThrow();
  const search = new URLSearchParams();
  if (targetType) search.set("target_type", targetType);
  if (edgeType) search.set("edge_type", edgeType);
  const query = search.size > 0 ? `?${search.toString()}` : "";
  const results = await restRequest<T[]>(
    `/restpp/graph/${encodeURIComponent(config.graphName)}/edges/${encodeURIComponent(vertexType)}/${encodeURIComponent(vertexId)}${query}`,
    config,
  );
  return Array.isArray(results) ? results : [results];
}

/**
 * Lightweight connectivity check using TigerGraph's built-in /restpp/echo
 * endpoint. Does not require the query to exist and does not touch graph
 * data — useful for distinguishing "not configured" / "auth failed" /
 * "unreachable" from an actual query-level failure.
 */
export async function checkTigerGraphConnection(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  let config: TigerGraphConfig;
  try {
    config = getConfigOrThrow();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "TigerGraph/Savanna is not configured.",
    };
  }

  try {
    const token = await getAuthToken(config);
    const response = await fetch(`${config.host}/restpp/echo`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body = (await response.json().catch(() => null)) as RestppEnvelope<unknown> | null;
    if (response.status === 401 || response.status === 403) {
      throw new TigerGraphAuthError(
        body?.message || "TigerGraph/Savanna rejected the credentials.",
      );
    }
    if (!response.ok || !body || body.error) {
      throw new TigerGraphRequestError(
        body?.message || `TigerGraph/Savanna echo failed (HTTP ${response.status}).`,
      );
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "TigerGraph/Savanna connectivity check failed.",
    };
  }
}
