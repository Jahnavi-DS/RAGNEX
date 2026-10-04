// Shared result contract for real GraphRAG execution.
//
// Deliberately parallel to src/server/rag-types.ts (same field families:
// evidence/sources, tokens, latency, confidence, model) so the UI can
// render RAG and GraphRAG results with a consistent shape, plus
// graph-specific fields (entities, relationships, traversal depth, node
// counts) that RAG has no equivalent for.

export type GraphEvidenceItem = {
  id: string;
  title: string;
  excerpt: string;
  /** "node" for a vertex-attribute fact, "relationship" for an edge fact. */
  kind: "node" | "relationship";
};

export type GraphRagEntity = {
  name: string;
  type: string | null;
  /** Whether this entity actually resolved to at least one graph node. */
  resolved: boolean;
};

export type GraphRagRelationship = {
  source: string;
  relation: string;
  target: string;
};

export type GraphRagRetrievalInfo = {
  /** Name of the retrieval implementation actually used, e.g. "tigergraph-savanna". */
  strategy: string;
  entitiesQueried: number;
  entitiesResolved: number;
  nodesRetrieved: number;
  relationshipsRetrieved: number;
  traversalDepth: number;
};

export type GraphRagTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type GraphRagLatency = {
  entityExtractionMs: number | null;
  graphQueryMs: number | null;
  generationMs: number | null;
  totalMs: number | null;
};

export type GraphRagErrorCode =
  | "invalid_question"
  | "missing_api_key"
  | "missing_graph_config"
  | "graph_auth_failed"
  | "graph_query_failed"
  | "empty_entities"
  | "empty_graph_retrieval"
  | "groq_error"
  | "timeout"
  | "unknown";

export type GraphRagSuccessResult = {
  status: "success";
  question: string;
  answer: string;
  entities: GraphRagEntity[];
  relationships: GraphRagRelationship[];
  evidence: GraphEvidenceItem[];
  sources: GraphEvidenceItem[];
  retrieval: GraphRagRetrievalInfo;
  tokens: GraphRagTokenUsage;
  latency: GraphRagLatency;
  /** Fraction of queried entities that resolved to graph data. Null if none queried. */
  confidence: number | null;
  model: string;
};

export type GraphRagErrorResult = {
  status: "error";
  question: string;
  code: GraphRagErrorCode;
  message: string;
  latency: GraphRagLatency;
  entities?: GraphRagEntity[] | undefined;
  relationships?: GraphRagRelationship[] | undefined;
  evidence?: GraphEvidenceItem[] | undefined;
  retrieval?: GraphRagRetrievalInfo | undefined;
  confidence?: number | null | undefined;
  tokens?: GraphRagTokenUsage | undefined;
};

export type GraphRagResult = GraphRagSuccessResult | GraphRagErrorResult;
