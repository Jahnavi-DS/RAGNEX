import { GroqConfigError, GroqRequestError, generateGroundedAnswer } from "@/server/groq";
import {
  EntityExtractionError,
  TigerGraphAuthError,
  TigerGraphConfigError,
  TigerGraphRequestError,
  identifyEntities,
  ResilientGraphRetriever,
} from "@/server/retrieval/graph-retriever";
import type {
  GraphEvidenceItem,
  GraphRagLatency,
  GraphRagRelationship,
  GraphRagResult,
} from "@/server/graphrag-types";
import type {
  GraphNodeFact,
  GraphRelationshipFact,
  GraphRetriever,
} from "@/server/retrieval/graph-types";
import {
  prioritizeEvidence,
  PROMPT_EVIDENCE_LIMIT,
  PROMPT_EXCERPT_LIMIT,
} from "@/lib/evidence-ranking";

// Retrieval is injected behind the GraphRetriever interface (see
// src/server/retrieval/graph-types.ts) — this is the ONLY implementation
// wired in for real GraphRAG execution. GraphRAG has its own independent
// retrieval path; it does not call into src/server/approaches/rag.ts.
const graphRetriever: GraphRetriever = new ResilientGraphRetriever();

const TRAVERSAL_DEPTH = 2;

function emptyLatency(): GraphRagLatency {
  return { entityExtractionMs: null, graphQueryMs: null, generationMs: null, totalMs: null };
}

function nodeToEvidence(node: GraphNodeFact, index: number): GraphEvidenceItem {
  const attributeText = Object.entries(node.attributes)
    .filter(([key]) => key !== "name" && key !== "title" && key !== "label" && key !== "text")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
  const documentText = typeof node.attributes["text"] === "string" ? node.attributes["text"] : "";
  return {
    id: `node-${index}-${node.id}`,
    title: `${node.label} (${node.vertexType})`,
    excerpt:
      (documentText ? documentText.slice(0, 1200) : "") ||
      attributeText ||
      `${node.vertexType} vertex "${node.label}" from the graph.`,
    kind: "node",
  };
}

function edgeToEvidence(edge: GraphRelationshipFact, index: number): GraphEvidenceItem {
  return {
    id: `edge-${index}-${edge.sourceId}-${edge.targetId}`,
    title: `${edge.sourceLabel} → ${edge.edgeType} → ${edge.targetLabel}`,
    excerpt: `Graph relationship: ${edge.sourceLabel} (${edge.edgeType}) ${edge.targetLabel}.`,
    kind: "relationship",
  };
}

function buildPrompt(question: string, evidence: GraphEvidenceItem[]): string {
  const selectedEvidence = prioritizeEvidence(question, evidence, PROMPT_EVIDENCE_LIMIT);
  const context = selectedEvidence
    .map(
      (item, index) =>
        `[${index + 1}] ${item.title}\n${item.excerpt.slice(0, PROMPT_EXCERPT_LIMIT)}`,
    )
    .join("\n\n");

  return [
    "You are a research assistant answering strictly from the supplied graph evidence.",
    "Answer using the supplied graph evidence. Do not invent unsupported facts.",
    "If the graph evidence does not contain enough information to answer, say so explicitly instead of guessing.",
    "Cite evidence inline using its bracketed number, e.g. [1].",
    "",
    "Graph evidence:",
    context,
    "",
    `Question: ${question}`,
    "",
    "Answer:",
  ].join("\n");
}

/**
 * Runs the real GraphRAG pipeline, independently of the RAG pipeline:
 * validate -> identify entities (Groq) -> traverse TigerGraph/Savanna ->
 * extract evidence -> synthesize with Groq -> return a grounded answer
 * with real graph evidence and metrics. Never throws — failures are
 * returned as a GraphRagErrorResult.
 */
export async function runGraphRag(rawQuestion: string): Promise<GraphRagResult> {
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

  // --- 1. Entity identification (Groq) ---
  let entityExtractionMs: number;
  let entityTokenUsage: Awaited<ReturnType<typeof identifyEntities>>["tokenUsage"];
  let extractedEntities: Awaited<ReturnType<typeof identifyEntities>>["entities"];
  try {
    const result = await identifyEntities(question);
    extractedEntities = result.entities;
    entityExtractionMs = result.latencyMs;
    entityTokenUsage = result.tokenUsage;
  } catch (error) {
    const latency = { ...emptyLatency(), totalMs: performance.now() - startedAt };
    if (error instanceof GroqConfigError) {
      return {
        status: "error",
        question,
        code: "missing_api_key",
        message: error.message,
        latency,
      };
    }
    if (error instanceof GroqRequestError) {
      return { status: "error", question, code: "groq_error", message: error.message, latency };
    }
    if (error instanceof EntityExtractionError) {
      return { status: "error", question, code: "unknown", message: error.message, latency };
    }
    return {
      status: "error",
      question,
      code: "unknown",
      message: error instanceof Error ? error.message : "Entity extraction failed unexpectedly.",
      latency,
    };
  }

  if (extractedEntities.length === 0) {
    return {
      status: "error",
      question,
      code: "empty_entities",
      message: "No entities could be identified from the question to look up in the graph.",
      latency: {
        entityExtractionMs,
        graphQueryMs: null,
        generationMs: null,
        totalMs: performance.now() - startedAt,
      },
    };
  }

  // --- 2. Graph traversal (TigerGraph/Savanna) ---
  const graphQueryStart = performance.now();
  let outcome;
  try {
    outcome = await graphRetriever.retrieve(extractedEntities, TRAVERSAL_DEPTH);
  } catch (error) {
    const latency = {
      entityExtractionMs,
      graphQueryMs: performance.now() - graphQueryStart,
      generationMs: null,
      totalMs: performance.now() - startedAt,
    };
    if (error instanceof TigerGraphConfigError) {
      return {
        status: "error",
        question,
        code: "missing_graph_config",
        message: error.message,
        latency,
      };
    }
    if (error instanceof TigerGraphAuthError) {
      return {
        status: "error",
        question,
        code: "graph_auth_failed",
        message: error.message,
        latency,
      };
    }
    if (error instanceof TigerGraphRequestError) {
      return {
        status: "error",
        question,
        code: "graph_query_failed",
        message: error.message,
        latency,
      };
    }
    return {
      status: "error",
      question,
      code: "unknown",
      message: error instanceof Error ? error.message : "Graph retrieval failed unexpectedly.",
      latency,
    };
  }
  const graphQueryMs = performance.now() - graphQueryStart;

  if (outcome.nodes.length === 0 && outcome.relationships.length === 0) {
    return {
      status: "error",
      question,
      code: "empty_graph_retrieval",
      message:
        "No matching entities, nodes, or relationships were found in the graph for this question.",
      latency: {
        entityExtractionMs,
        graphQueryMs,
        generationMs: null,
        totalMs: performance.now() - startedAt,
      },
    };
  }

  // --- 3. Evidence extraction ---
  const evidence: GraphEvidenceItem[] = prioritizeEvidence(question, [
    ...outcome.relationships.map(edgeToEvidence),
    ...outcome.nodes.map(nodeToEvidence),
  ]);
  const relationships: GraphRagRelationship[] = outcome.relationships.map((edge) => ({
    source: edge.sourceLabel,
    relation: edge.edgeType,
    target: edge.targetLabel,
  }));

  // --- 4. Groq synthesis ---
  const prompt = buildPrompt(question, evidence);
  try {
    const generation = await generateGroundedAnswer(prompt);
    const totalMs = performance.now() - startedAt;
    const entitiesQueried = extractedEntities.length;
    const entitiesResolved = outcome.resolvedEntities.length;

    return {
      status: "success",
      question,
      answer: generation.text,
      entities: extractedEntities.map((entity) => ({
        name: entity.name,
        type: entity.type,
        resolved: outcome.resolvedEntities.includes(entity.name),
      })),
      relationships,
      evidence,
      sources: evidence,
      retrieval: {
        strategy: outcome.strategy,
        entitiesQueried,
        entitiesResolved,
        nodesRetrieved: outcome.nodes.length,
        relationshipsRetrieved: outcome.relationships.length,
        traversalDepth: outcome.traversalDepth,
      },
      tokens: {
        promptTokens:
          entityTokenUsage.promptTokens === null || generation.usage.promptTokens === null
            ? null
            : entityTokenUsage.promptTokens + generation.usage.promptTokens,
        completionTokens:
          entityTokenUsage.completionTokens === null || generation.usage.completionTokens === null
            ? null
            : entityTokenUsage.completionTokens + generation.usage.completionTokens,
        totalTokens:
          entityTokenUsage.totalTokens === null || generation.usage.totalTokens === null
            ? null
            : entityTokenUsage.totalTokens + generation.usage.totalTokens,
      },
      latency: { entityExtractionMs, graphQueryMs, generationMs: generation.latencyMs, totalMs },
      confidence: entitiesQueried > 0 ? entitiesResolved / entitiesQueried : null,
      model: generation.model,
    };
  } catch (error) {
    const latency: GraphRagLatency = {
      entityExtractionMs,
      graphQueryMs,
      generationMs: null,
      totalMs: performance.now() - startedAt,
    };
    if (error instanceof GroqConfigError || error instanceof GroqRequestError) {
      return {
        status: "error",
        question,
        code: error instanceof GroqConfigError ? "missing_api_key" : "groq_error",
        message: error.message,
        entities: extractedEntities.map((entity) => ({
          name: entity.name,
          type: entity.type,
          resolved: outcome.resolvedEntities.includes(entity.name),
        })),
        relationships,
        evidence,
        retrieval: {
          strategy: outcome.strategy,
          entitiesQueried: extractedEntities.length,
          entitiesResolved: outcome.resolvedEntities.length,
          nodesRetrieved: outcome.nodes.length,
          relationshipsRetrieved: outcome.relationships.length,
          traversalDepth: outcome.traversalDepth,
        },
        confidence:
          extractedEntities.length > 0
            ? outcome.resolvedEntities.length / extractedEntities.length
            : null,
        tokens: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        latency,
      };
    }
    return {
      status: "error",
      question,
      code: "unknown",
      message: error instanceof Error ? error.message : "GraphRAG execution failed unexpectedly.",
      latency,
    };
  }
}
