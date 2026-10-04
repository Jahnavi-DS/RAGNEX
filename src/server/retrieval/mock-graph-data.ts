// DEVELOPMENT-ONLY MOCK GRAPH DATA.
// ----------------------------------
// This file is NOT imported by src/server/approaches/graphrag.ts and is NOT
// part of the real GraphRAG pipeline. It exists only so a developer can
// exercise the `GraphRetriever` interface locally, offline, before a real
// TigerGraph/Savanna graph is provisioned — e.g. by temporarily swapping
// `new TigerGraphRetriever()` for `new MockGraphRetriever()` in
// src/server/approaches/graphrag.ts during local development.
//
// It must never be wired in by default: doing so would silently present
// fabricated graph results as real TigerGraph output, which this project
// explicitly avoids. `strategy` is reported as "mock-dev-graph" specifically
// so it can never be confused with "tigergraph-savanna" in the UI/metrics.

import type {
  GraphEntity,
  GraphNodeFact,
  GraphRelationshipFact,
  GraphRetrievalOutcome,
  GraphRetriever,
} from "./graph-types";

const MOCK_NODES: GraphNodeFact[] = [
  {
    id: "company-x",
    vertexType: "Company",
    label: "Company X",
    attributes: { industry: "Software" },
  },
  {
    id: "company-y",
    vertexType: "Company",
    label: "Company Y",
    attributes: { industry: "Enterprise distribution" },
  },
  { id: "product-z", vertexType: "Product", label: "Product Z", attributes: { launched: "2024" } },
];

const MOCK_EDGES: GraphRelationshipFact[] = [
  {
    sourceId: "company-x",
    sourceLabel: "Company X",
    edgeType: "acquired",
    targetId: "company-y",
    targetLabel: "Company Y",
  },
  {
    sourceId: "company-y",
    sourceLabel: "Company Y",
    edgeType: "enabled",
    targetId: "product-z",
    targetLabel: "Product Z",
  },
];

export class MockGraphRetriever implements GraphRetriever {
  readonly strategy = "mock-dev-graph";

  async retrieve(entities: GraphEntity[], depth: number): Promise<GraphRetrievalOutcome> {
    const wanted = new Set(entities.map((entity) => entity.name.toLowerCase()));
    const nodes = MOCK_NODES.filter((node) => wanted.has(node.label.toLowerCase()));
    const resolvedEntities = nodes.map((node) => node.label);
    const relationships = MOCK_EDGES.filter(
      (edge) =>
        wanted.has(edge.sourceLabel.toLowerCase()) || wanted.has(edge.targetLabel.toLowerCase()),
    );

    return {
      resolvedEntities,
      nodes,
      relationships,
      strategy: this.strategy,
      traversalDepth: depth,
    };
  }
}
