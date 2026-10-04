// Shared result contract for real RAG execution.
//
// This is intentionally separate from `src/lib/demo-data.ts`'s
// `ApproachResult` type: that type carries benchmark-style fields
// (accuracy, completeness, evidenceQuality) that only make sense for
// canned demo data scored against a fixed rubric. Real Groq output has
// no such ground truth, so this contract only reports things that were
// actually measured.

export type RagSource = {
  id: string;
  title: string;
  excerpt: string;
  documentType?: string | undefined;
  date?: string | undefined;
  url?: string | undefined;
  /** Real retrieval relevance score (0-1), not a fabricated metric. */
  relevance: number;
};

export type RagRetrievalInfo = {
  /** Name of the retrieval implementation actually used, e.g. "official-corpus-keyword". */
  strategy: string;
  documentsSearched: number;
  chunksRetrieved: number;
};

export type RagTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type RagLatency = {
  retrievalMs: number | null;
  generationMs: number | null;
  totalMs: number | null;
};

export type RagErrorCode =
  "invalid_question" | "missing_api_key" | "empty_retrieval" | "groq_error" | "timeout" | "unknown";

export type RagSuccessResult = {
  status: "success";
  question: string;
  answer: string;
  evidence: RagSource[];
  sources: RagSource[];
  retrieval: RagRetrievalInfo;
  tokens: RagTokenUsage;
  latency: RagLatency;
  /** Derived from the top retrieval relevance score. Null if nothing was retrieved. */
  confidence: number | null;
  model: string;
};

export type RagErrorResult = {
  status: "error";
  question: string;
  code: RagErrorCode;
  message: string;
  latency: RagLatency;
  sources?: RagSource[] | undefined;
};

export type RagResult = RagSuccessResult | RagErrorResult;
