const host = process.env["TIGERGRAPH_HOST"]?.trim().replace(/\/+$/, "");
const graph = process.env["TIGERGRAPH_GRAPH_NAME"]?.trim();
const secret = process.env["TIGERGRAPH_SECRET"]?.trim();
const queryName = process.env["TIGERGRAPH_QUERY_NAME"]?.trim() || "event_neighborhood";
const lifetime = process.env["TIGERGRAPH_TOKEN_LIFETIME_SECONDS"]?.trim() || "2592000";

console.log(
  "Environment presence",
  JSON.stringify({
    TIGERGRAPH_HOST: Boolean(host),
    TIGERGRAPH_GRAPH_NAME: Boolean(graph),
    TIGERGRAPH_SECRET: Boolean(secret),
  }),
);
if (!host || !graph || !secret) throw new Error("TigerGraph configuration is incomplete.");

const tokenResponse = await fetch(`${host}/gsql/v1/tokens`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ secret, graph, lifetime }),
});
const tokenBody = await tokenResponse.json().catch(() => null);
const token = tokenBody?.token ?? tokenBody?.results?.token;
console.log("Token generation", token ? "SUCCESS" : "FAIL", "HTTP", tokenResponse.status);
if (!tokenResponse.ok || !token) throw new Error("TigerGraph token generation failed.");
console.log("Graph", graph, "Query", queryName);

const headers = { Authorization: `Bearer ${token}` };
const venueResponse = await fetch(
  `${host}/restpp/graph/${encodeURIComponent(graph)}/vertices/Venue?limit=1000`,
  { headers },
);
const venueBody = await venueResponse.json().catch(() => null);
const venue = venueBody?.results?.find(
  (vertex) => vertex.attributes?.venue_name?.toLowerCase() === "eton dorney",
);
console.log("Live Venue lookup", venue ? "SUCCESS" : "FAIL", "HTTP", venueResponse.status);
if (!venue?.v_id) throw new Error("Eton Dorney was not found among live Venue vertices.");

const edgeResponse = await fetch(
  `${host}/restpp/graph/${encodeURIComponent(graph)}/edges/Venue/${encodeURIComponent(venue.v_id)}?target_type=Event&edge_type=AT_VENUE`,
  { headers },
);
const edgeBody = await edgeResponse.json().catch(() => null);
const edge = edgeBody?.results?.[0];
if (!edge?.to_id || edge.to_type !== "Event") {
  throw new Error("No real Event neighbor was returned for Eton Dorney.");
}
const eventResponse = await fetch(
  `${host}/restpp/graph/${encodeURIComponent(graph)}/vertices/Event/${encodeURIComponent(edge.to_id)}`,
  { headers },
);
const eventBody = await eventResponse.json().catch(() => null);
const event = eventBody?.results?.[0];
const eventId = event?.v_id ?? edge.to_id;
console.log("Real connected Event", eventId, event?.attributes?.event_name ?? "name unavailable");

const queryResponse = await fetch(
  `${host}/restpp/query/${encodeURIComponent(graph)}/${encodeURIComponent(queryName)}?event_id=${encodeURIComponent(eventId)}`,
  { headers },
);
const queryBody = await queryResponse.json().catch(() => null);
console.log("Installed query response status", queryResponse.status);
console.log("Installed query response code", queryBody?.code ?? "none");
console.log("Installed query error", queryBody?.error ?? "unknown");
console.log("Installed query message", queryBody?.message ?? "none");
if (queryBody?.results !== undefined) {
  const results = Array.isArray(queryBody.results) ? queryBody.results : [queryBody.results];
  console.log("Result container", Array.isArray(queryBody.results) ? "array" : "object");
  console.log("Result set count", results.length);
  console.log(
    "Result set keys",
    JSON.stringify(results.map((result) => Object.keys(result ?? {}))),
  );
}
