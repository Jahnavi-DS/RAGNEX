// Retrieval-layer contract.
//
// Retrieval is expressed as a small interface so the official corpus index,
// a future vector service, and TigerGraph-backed retrieval remain swappable.

export type RetrievedDocument = {
  /** Stable identifier for the source document. */
  id: string;
  /** Human-readable title, shown to the user as a source/evidence item. */
  title: string;
  /** The retrieved text passed to the model as grounding context. */
  content: string;
  /** Optional metadata surfaced alongside the evidence card. */
  documentType?: string;
  date?: string;
  url?: string;
  /**
   * Real, computed relevance score for this retrieval (0-1). This is a
   * genuine similarity/overlap score from the retrieval implementation —
   * never a fabricated benchmark number.
   */
  score: number;
};

export type RetrievalOutcome = {
  documents: RetrievedDocument[];
  /** Total number of documents the retriever searched over. */
  documentsSearched: number;
  /** Name of the retrieval implementation that produced this result. */
  strategy: string;
};

export interface DocumentRetriever {
  /** Human-readable name of this retrieval strategy, e.g. "official-corpus-keyword". */
  readonly strategy: string;
  retrieve(query: string, topK?: number): Promise<RetrievalOutcome>;
}
