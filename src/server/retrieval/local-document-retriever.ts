import { chunkDocument, loadCorpusDocuments, type CorpusChunk, type CorpusDocument } from "@/server/ingestion/corpus";
import type { DocumentRetriever, RetrievalOutcome, RetrievedDocument } from "./types";

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "what", "why", "how", "did", "does", "with",
  "that", "this", "from", "have", "has", "had", "not", "but", "its", "into", "about", "which",
  "who", "whom", "can", "could", "would", "should", "will", "shall", "than", "then", "there",
  "their", "you", "your", "our", "out", "over", "under", "these", "those", "when",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

type IndexedChunk = CorpusChunk & { document: CorpusDocument; terms: Set<string> };

function buildIndex(documents: CorpusDocument[]): IndexedChunk[] {
  return documents.flatMap((document) =>
    chunkDocument(document).map((chunk) => ({
      ...chunk,
      document,
      terms: new Set(tokenize(chunk.text)),
    })),
  );
}

function scoreChunk(queryTerms: string[], chunk: IndexedChunk): number {
  if (queryTerms.length === 0) return 0;
  const matches = queryTerms.filter((term) => chunk.terms.has(term)).length;
  return matches / queryTerms.length;
}

export class LocalDocumentRetriever implements DocumentRetriever {
  readonly strategy = "official-corpus-keyword";
  private readonly documentCount: number;
  private readonly index: IndexedChunk[];

  constructor() {
    const documents = loadCorpusDocuments();
    this.documentCount = documents.length;
    this.index = buildIndex(documents);
  }

  async retrieve(query: string, topK = 4): Promise<RetrievalOutcome> {
    const queryTerms = tokenize(query);
    const scored = this.index
      .map((chunk) => ({ chunk, score: scoreChunk(queryTerms, chunk) }))
      .sort((a, b) => b.score - a.score);
    const selected = scored.some((item) => item.score > 0)
      ? scored.filter((item) => item.score > 0).slice(0, topK)
      : scored.slice(0, topK);
    const documents: RetrievedDocument[] = selected.map(({ chunk, score }) => ({
      id: chunk.chunkId,
      title: chunk.document.title,
      content: chunk.text,
      url: chunk.document.url,
      score,
    }));
    return {
      documents,
      documentsSearched: this.documentCount,
      strategy: this.strategy,
    };
  }
}
