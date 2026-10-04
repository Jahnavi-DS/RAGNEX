import {
  iterateCorpusDocuments,
  iterateDocumentChunks,
  type CorpusChunk,
  type CorpusDocument,
} from "@/server/ingestion/corpus";
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

type ScoredChunk = CorpusChunk & { document: CorpusDocument; score: number };

function scoreChunk(queryTerms: string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const terms = new Set(tokenize(text));
  const matches = queryTerms.filter((term) => terms.has(term)).length;
  return matches / queryTerms.length;
}

function retainTopChunks(candidates: ScoredChunk[], candidate: ScoredChunk, topK: number): void {
  let index = 0;
  while (index < candidates.length && candidates[index]!.score >= candidate.score) index++;
  candidates.splice(index, 0, candidate);
  if (candidates.length > topK) candidates.pop();
}

export class LocalDocumentRetriever implements DocumentRetriever {
  readonly strategy = "official-corpus-keyword";

  async retrieve(query: string, topK = 4): Promise<RetrievalOutcome> {
    const queryTerms = tokenize(query);
    const matching: ScoredChunk[] = [];
    const fallback: ScoredChunk[] = [];
    let documentCount = 0;

    for await (const document of iterateCorpusDocuments()) {
      documentCount++;
      for (const chunk of iterateDocumentChunks(document)) {
        const score = scoreChunk(queryTerms, chunk.text);
        if (score > 0 && topK > 0) {
          retainTopChunks(matching, { ...chunk, document, score }, topK);
        } else if (fallback.length < topK) {
          fallback.push({ ...chunk, document, score });
        }
      }
    }

    const selected = matching.length > 0 ? matching : fallback;
    const documents: RetrievedDocument[] = selected.map((chunk) => ({
      id: chunk.chunkId,
      title: chunk.document.title,
      content: chunk.text,
      url: chunk.document.url,
      score: chunk.score,
    }));
    return {
      documents,
      documentsSearched: documentCount,
      strategy: this.strategy,
    };
  }
}
