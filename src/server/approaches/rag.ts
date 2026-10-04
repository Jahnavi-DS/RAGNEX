import { GroqConfigError, GroqRequestError, generateGroundedAnswer } from "@/server/groq";
import { LocalDocumentRetriever } from "@/server/retrieval/local-document-retriever";
import type { DocumentRetriever } from "@/server/retrieval/types";
import type { RagLatency, RagResult, RagSource } from "@/server/rag-types";

// Retrieval is injected behind the DocumentRetriever interface so the official
// corpus index can later be replaced by a provisioned vector service without
// changing the RAG pipeline.
const retriever: DocumentRetriever = new LocalDocumentRetriever();

const TOP_K = 4;

function buildPrompt(question: string, contextDocs: RagSource[]): string {
  const context = contextDocs
    .map((doc, index) => `[${index + 1}] ${doc.title}\n${doc.excerpt}`)
    .join("\n\n");

  return [
    "You are a research assistant answering strictly from the provided context.",
    "Only use facts from the context below. If the context does not contain enough information to answer, say so explicitly instead of guessing.",
    "Cite sources inline using their bracketed numbers, e.g. [1].",
    "",
    "Context:",
    context,
    "",
    `Question: ${question}`,
    "",
    "Answer:",
  ].join("\n");
}

function emptyLatency(): RagLatency {
  return { retrievalMs: null, generationMs: null, totalMs: null };
}

/**
 * Runs the real RAG pipeline: validate -> retrieve -> select context ->
 * generate with Groq -> return a grounded answer with real evidence and
 * metrics. Never throws — failures are returned as a RagErrorResult so the
 * caller (the server function) can pass a clean, serializable result back
 * to the UI.
 */
export async function runRag(rawQuestion: string): Promise<RagResult> {
  const startedAt = performance.now();
  const question = rawQuestion.trim();

  if (!question) {
    return {
      status: "error",
      question,
      code: "invalid_question",
      message: "Please enter a question before running the investigation.",
      latency: emptyLatency(),
    };
  }

  const retrievalStart = performance.now();
  let retrieval;
  try {
    retrieval = await retriever.retrieve(question, TOP_K);
  } catch (error) {
    return {
      status: "error",
      question,
      code: "unknown",
      message: error instanceof Error ? error.message : "Document retrieval failed.",
      latency: emptyLatency(),
    };
  }
  const retrievalMs = performance.now() - retrievalStart;

  if (retrieval.documents.length === 0) {
    return {
      status: "error",
      question,
      code: "empty_retrieval",
      message: "No relevant documents were found in the local corpus for this question.",
      latency: { retrievalMs, generationMs: null, totalMs: performance.now() - startedAt },
    };
  }

  const sources: RagSource[] = retrieval.documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    excerpt: doc.content,
    documentType: doc.documentType,
    date: doc.date,
    url: doc.url,
    relevance: doc.score,
  }));

  const prompt = buildPrompt(question, sources);

  try {
    const generation = await generateGroundedAnswer(prompt);
    const totalMs = performance.now() - startedAt;
    const topRelevance = sources[0]?.relevance ?? null;

    return {
      status: "success",
      question,
      answer: generation.text,
      evidence: sources,
      sources,
      retrieval: {
        strategy: retrieval.strategy,
        documentsSearched: retrieval.documentsSearched,
        chunksRetrieved: retrieval.documents.length,
      },
      tokens: generation.usage,
      latency: { retrievalMs, generationMs: generation.latencyMs, totalMs },
      confidence: topRelevance,
      model: generation.model,
    };
  } catch (error) {
    const latency: RagLatency = {
      retrievalMs,
      generationMs: null,
      totalMs: performance.now() - startedAt,
    };
    return {
      status: "error",
      question,
      code:
        error instanceof GroqConfigError
          ? "missing_api_key"
          : error instanceof GroqRequestError
            ? "groq_error"
            : "unknown",
      message: error instanceof Error ? error.message : "RAG execution failed unexpectedly.",
      latency,
      sources,
    };
  }
}
