// Shared result contract for real Agentic GraphRAG execution.
//
// Deliberately parallel to src/server/rag-types.ts and
// src/server/graphrag-types.ts (same field families: evidence/sources,
// tokens, latency, confidence, model) so the UI can render all three
// approaches with a consistent shape, plus agent-specific fields
// (investigation trace, tool calls, iterations, stopping reason) that the
// non-agentic approaches have no equivalent for.

export type AgenticEvidenceItem = {
  id: string;
  title: string;
  excerpt: string;
  /** "document" for a retrieved passage, "node" for a vertex fact, "relationship" for an edge fact. */
  kind: "document" | "node" | "relationship";
  /** Real relevance/confidence score (0-1) where one was computed, otherwise null. */
  score: number | null;
};

export type AgenticEntity = {
  name: string;
  type: string | null;
  /** Whether this entity actually resolved to at least one graph node. */
  resolved: boolean;
};

export type AgenticRelationship = {
  source: string;
  relation: string;
  target: string;
};

/** The tools the orchestrator can choose to execute on any given iteration. */
export type AgentToolName =
  "extract_entities" | "search_documents" | "search_graph" | "traverse_graph" | "evaluate_evidence";

/** A tool choice, or the terminal decision to stop investigating and answer. */
export type AgentAction = AgentToolName | "generate_answer";

export type AgentTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

/** Structured record of a single tool execution, for the trace/UI. */
export type AgenticToolCall = {
  iteration: number;
  tool: AgentToolName;
  input: Record<string, string | number>;
  success: boolean;
  outputSummary: string;
  latencyMs: number;
  tokenUsage: AgentTokenUsage | null;
  evidenceReturned: number;
  error?: string;
};

export type AgenticProgressToolCall = Pick<
  AgenticToolCall,
  "tool" | "success" | "evidenceReturned"
>;

export type AgenticProgressUpdate = {
  questionAccepted: boolean;
  activeAction: AgentToolName | "generate_answer" | null;
  toolCalls: AgenticProgressToolCall[];
  finalAnswerState: "pending" | "in_progress" | "completed" | "failed";
};

export type AgenticProgressSnapshot = AgenticProgressUpdate & {
  finished: boolean;
};

/** Structured record of a single agent decision + its outcome, for the trace/UI. */
export type AgenticTraceEvent = {
  iteration: number;
  objective: string;
  action: AgentAction;
  reason: string;
  toolCall: AgenticToolCall | null;
  confidenceBefore: number | null;
  confidenceAfter: number | null;
  evidenceCountAfter: number;
};

export type AgenticStoppingReason =
  | "sufficient_evidence"
  | "high_confidence"
  | "question_answered"
  | "no_useful_next_action"
  | "max_iterations_reached"
  | "retrieval_failure"
  | "insufficient_evidence"
  | "tool_failure";

export type AgenticRetrievalStats = {
  /** Actual live REST++ strategy, labeled local corpus fallback, or "not-used". */
  graphStrategy: string;
  /** "official-corpus-keyword", or "not-used". */
  documentStrategy: string;
  entitiesQueried: number;
  entitiesResolved: number;
  documentsRetrieved: number;
  nodesDiscovered: number;
  relationshipsDiscovered: number;
  maxTraversalDepth: number;
};

export type AgenticLatency = {
  planningMs: number;
  toolMs: number;
  generationMs: number | null;
  totalMs: number;
};

export type AgenticErrorCode =
  | "invalid_question"
  | "missing_api_key"
  | "planning_failed"
  | "no_evidence"
  | "tool_failure"
  | "groq_error"
  | "unknown";

export type AgenticSuccessResult = {
  status: "success";
  question: string;
  answer: string;
  answerSource?: "groq" | "fallback_local_evidence";
  confidence: number | null;
  evidence: AgenticEvidenceItem[];
  sources: AgenticEvidenceItem[];
  entities: AgenticEntity[];
  relationships: AgenticRelationship[];
  trace: AgenticTraceEvent[];
  toolCalls: AgenticToolCall[];
  iterations: number;
  stoppingReason: AgenticStoppingReason;
  retrieval: AgenticRetrievalStats;
  tokens: AgentTokenUsage;
  latency: AgenticLatency;
  model: string;
  /** True when graph tools used the explicitly labeled local corpus fallback. */
  graphFallbackMode: boolean;
};

export type AgenticErrorResult = {
  status: "error";
  question: string;
  code: AgenticErrorCode;
  message: string;
  trace: AgenticTraceEvent[];
  toolCalls: AgenticToolCall[];
  iterations: number;
  latency: AgenticLatency;
  evidence?: AgenticEvidenceItem[] | undefined;
  confidence?: number | null | undefined;
  entities?: AgenticEntity[] | undefined;
  relationships?: AgenticRelationship[] | undefined;
  retrieval?: AgenticRetrievalStats | undefined;
  tokens?: AgentTokenUsage | undefined;
  graphFallbackMode?: boolean | undefined;
};

export type AgenticResult = AgenticSuccessResult | AgenticErrorResult;
