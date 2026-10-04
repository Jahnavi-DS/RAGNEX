// Graph retrieval-layer contract for GraphRAG.
//
// Mirrors the shape of src/server/retrieval/types.ts (the RAG document
// retrieval contract) so both pipelines follow the same "small interface,
// swappable implementation" pattern. `TigerGraphRetriever` is the real,
// production implementation backed by TigerGraph/Savanna. It is the only
// implementation wired into src/server/approaches/graphrag.ts.

export type GraphEntity = {
  /** The entity's name/surface form, as identified from the question. */
  name: string;
  /** Optional coarse type (e.g. "company", "person", "product") if known. */
  type: string | null;
};

export type GraphNodeFact = {
  /** Stable vertex id/identifier as returned by the graph. */
  id: string;
  /** Vertex type, e.g. "Company", "Person". */
  vertexType: string;
  /** Human-readable label for display. */
  label: string;
  /** Raw attributes returned for this vertex, for evidence text. */
  attributes: Record<string, unknown>;
};

export type GraphRelationshipFact = {
  sourceId: string;
  sourceLabel: string;
  edgeType: string;
  targetId: string;
  targetLabel: string;
};

export type GraphRetrievalOutcome = {
  /** Entities that were actually resolved to at least one graph node. */
  resolvedEntities: string[];
  nodes: GraphNodeFact[];
  relationships: GraphRelationshipFact[];
  /** Name of the retrieval implementation that produced this result. */
  strategy: string;
  /** Traversal depth (hops) actually requested. */
  traversalDepth: number;
};

export interface GraphRetriever {
  /** Human-readable name of this retrieval strategy, e.g. "tigergraph-savanna". */
  readonly strategy: string;
  retrieve(entities: GraphEntity[], depth: number): Promise<GraphRetrievalOutcome>;
}
