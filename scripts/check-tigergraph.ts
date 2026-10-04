import { isTigerGraphConfigured, checkTigerGraphConnection } from "../src/server/tigergraph.ts";

async function main() {
  if (!isTigerGraphConfigured()) {
    console.error(
      "TigerGraph is not configured. Set TIGERGRAPH_HOST and TIGERGRAPH_GRAPH_NAME, " +
        "plus either TIGERGRAPH_TOKEN or TIGERGRAPH_SECRET in your .env file.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("TigerGraph config detected. Checking connectivity...");

  const result = await checkTigerGraphConnection();

  if (result.ok) {
    console.log("✅ TigerGraph/Savanna connection succeeded.");
  } else {
    console.error(`❌ TigerGraph/Savanna connection failed: ${result.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unexpected error while checking TigerGraph connectivity:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
