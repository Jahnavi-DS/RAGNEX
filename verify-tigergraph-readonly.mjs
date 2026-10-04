#!/usr/bin/env node
/**
 * READ-ONLY TigerGraph/Savanna verification.
 *
 * This script performs ONLY GET requests and TigerGraph's built-in
 * stat_* read endpoints, plus the one unavoidable POST to exchange your
 * existing secret for a bearer token (no data is written by that call).
 * It does NOT create/alter schema, does NOT install queries, and does
 * NOT load or modify any data.
 *
 * It never prints TIGERGRAPH_SECRET or the bearer token.
 *
 * Usage (run from the ragnex/ project root, where your real .env lives):
 *   node --env-file=.env verify-tigergraph-readonly.mjs
 *
 * (Requires Node 18+ for --env-file and global fetch — same requirement
 * as the app itself.)
 */

function need(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name} in .env — aborting (nothing was contacted).`);
    process.exit(1);
  }
  return v;
}

const HOST = need("TIGERGRAPH_HOST").replace(/\/+$/, "");
const GRAPH = need("TIGERGRAPH_GRAPH_NAME");
const SECRET = need("TIGERGRAPH_SECRET");
const LIFETIME = process.env["TIGERGRAPH_TOKEN_LIFETIME_SECONDS"]?.trim() || "2592000";
const QUERY_NAME = process.env["TIGERGRAPH_QUERY_NAME"]?.trim() || "entity_neighborhood";

const LIVE_EVENT_QUERY = QUERY_NAME === "event_neighborhood";
const EXPECTED_VERTEX_TYPES = ["Document", "Event", "Games", "Venue"];
const EXPECTED_EDGE_TYPES = ["DESCRIBES", "HELD_AT", "AT_VENUE"];

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/**
 * Redacts anything that could leak the secret or a bearer token from a raw
 * response body before it is ever logged. Applied unconditionally, even
 * when the body doesn't look like it contains either.
 */
function sanitizeForLogging(rawText) {
  if (!rawText) return rawText;
  let out = rawText;
  if (SECRET) {
    out = out.split(SECRET).join("[REDACTED-SECRET]");
  }
  // Any quoted token-like field value (token, access_token, refresh_token, ...).
  out = out.replace(
    /("(?:token|access_token|refresh_token|apiToken)"\s*:\s*")[^"]*(")/gi,
    "$1[REDACTED-TOKEN]$2",
  );
  // A bare "Bearer <value>" if the host ever echoes one back.
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED-TOKEN]");
  return out;
}

async function getToken() {
  const url = `${HOST}/gsql/v1/tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: SECRET, graph: GRAPH, lifetime: LIFETIME }),
  });

  // Read as raw text first — do not assume JSON. A non-2xx response (e.g.
  // the HTTP 500 seen here) may return HTML, plain text, or malformed JSON,
  // and res.json() silently swallows all of that as `null`.
  const rawText = await res.text();
  const contentType = res.headers.get("content-type") ?? "(none)";

  console.log(`Request URL:  ${url}`);
  console.log(`HTTP status:  ${res.status}`);
  console.log(`Status text:  ${res.statusText}`);
  console.log(`Content-Type: ${contentType}`);
  console.log(`Raw response body (sanitized):\n${sanitizeForLogging(rawText)}`);

  let body = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = null;
  }
  const token = body?.token ?? body?.results?.token;
  if (!res.ok || !token) {
    throw new Error(`Token request failed (HTTP ${res.status}). See raw response body above.`);
  }
  return token;
}

async function authedGet(token, path) {
  const res = await fetch(`${HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function authedPost(token, path, payload) {
  const res = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  section("1. RAGNEX graph accessibility");
  console.log(`Host: ${HOST}`);
  console.log(`Graph: ${GRAPH}`);
  console.log("Requesting a token via POST /gsql/v1/tokens (auth exchange only, no data write)...");
  const token = await getToken();
  console.log("✅ Token exchange succeeded — graph/workspace is reachable and the secret is valid.");

  section("2 & 3. Vertex types and edge types (GET /restpp/schema/<graph>)");
  const schema = await authedGet(token, `/restpp/schema/${GRAPH}`);
  let vertexTypes = [];
  let edgeTypes = [];
  if (schema.ok && schema.body?.results) {
    vertexTypes = (schema.body.results.VertexTypes || []).map((v) => v.Name);
    edgeTypes = (schema.body.results.EdgeTypes || []).map((e) => e.Name);
    console.log("Vertex types found:", vertexTypes.length ? vertexTypes.join(", ") : "(none)");
    console.log("Edge types found:  ", edgeTypes.length ? edgeTypes.join(", ") : "(none)");
  } else {
    console.log(`❌ Could not read schema (HTTP ${schema.status}):`, schema.body?.message || schema.body);
  }

  section("4. Vertex counts (GET /restpp/graph/<graph>/vertices/<type>?count_only=true)");
  const vertexCounts = {};
  for (const type of EXPECTED_VERTEX_TYPES) {
    if (!vertexTypes.includes(type)) {
      console.log(`- ${type}: not present in schema`);
      continue;
    }
    const r = await authedGet(token, `/restpp/graph/${GRAPH}/vertices/${type}?count_only=true`);
    const count = Array.isArray(r.body?.results) ? r.body.results[0]?.count : undefined;
    vertexCounts[type] = count;
    console.log(r.ok ? `- ${type}: ${count} vertices` : `- ${type}: ERROR (HTTP ${r.status}) ${r.body?.message ?? ""}`);
  }

  section("5. Edge counts (built-in read-only stat_edge_number)");
  for (const type of EXPECTED_EDGE_TYPES) {
    if (!edgeTypes.includes(type)) {
      console.log(`- ${type}: not present in schema`);
      continue;
    }
    const r = await authedPost(token, `/restpp/builtins/${GRAPH}`, {
      function: "stat_edge_number",
      type,
    });
    const count = Array.isArray(r.body?.results) ? r.body.results[0]?.e_number : undefined;
    console.log(r.ok ? `- ${type}: ${count} edges` : `- ${type}: ERROR (HTTP ${r.status}) ${r.body?.message ?? ""}`);
  }

  section(`6. Is "${QUERY_NAME}" installed?`);
  const probeParams = LIVE_EVENT_QUERY
    ? "event_id=__verify_probe_nonexistent__"
    : "input=__verify_probe_nonexistent__&depth=0";
  const probe = await authedGet(token, `/restpp/query/${GRAPH}/${QUERY_NAME}?${probeParams}`);
  const notInstalled =
    probe.status === 404 ||
    /not found|does not exist|no rest endpoint/i.test(probe.body?.message || "");
  if (notInstalled) {
    console.log(`❌ "${QUERY_NAME}" does not appear to be installed (HTTP ${probe.status}): ${probe.body?.message ?? ""}`);
    console.log("Stopping here — no query to sample-run. Nothing was created or modified.");
    return;
  }
  console.log(`✅ "${QUERY_NAME}" is installed and responded (HTTP ${probe.status}).`);

  section("7. One safe sample run against a real, existing entity");
  const sampleType = LIVE_EVENT_QUERY ? "Event" : "Entity";
  if (!vertexCounts[sampleType]) {
    console.log(`${sampleType} count is 0/unknown — no real vertex available to sample. Skipping.`);
    return;
  }
  const sampleRes = await authedGet(
    token,
    `/restpp/graph/${GRAPH}/vertices/${sampleType}?limit=1`,
  );
  const sample = sampleRes.body?.results?.[0];
  if (!sample) {
    console.log("Could not fetch a sample Entity vertex. Skipping sample query.");
    return;
  }
  const sampleLabel =
    sample.attributes?.label ?? sample.attributes?.name ?? sample.v_id ?? String(sample);
  console.log(`Using existing entity as sample input: "${sampleLabel}" (v_id=${sample.v_id})`);

  const result = await authedGet(
    token,
    `/restpp/query/${GRAPH}/${QUERY_NAME}?${LIVE_EVENT_QUERY ? "event_id" : "input"}=${encodeURIComponent(LIVE_EVENT_QUERY ? sample.v_id : sampleLabel)}${LIVE_EVENT_QUERY ? "" : "&depth=1"}`,
  );
  console.log(`Query HTTP status: ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
}

main().catch((err) => {
  console.error("\n❌ Verification stopped due to an error:", err.message || err);
  process.exitCode = 1;
});
