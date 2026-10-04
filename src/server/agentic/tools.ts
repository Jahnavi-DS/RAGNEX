// SERVER-ONLY MODULE.
//
// Typed tool system for the Agentic GraphRAG orchestrator. Each tool wraps
// existing, real infrastructure (the same LocalDocumentRetriever, Groq
// wrapper, and graph retrievers used by src/server/approaches/rag.ts and
// src/server/approaches/graphrag.ts) rather than reimplementing retrieval
// or generation logic. Tools never fabricate results: retrieval/generation
// failures are surfaced as `success: false` with a real error message.

import { GroqConfigError, GroqRequestError, generateGroundedAnswer } from "@/server/groq";
import { LocalDocumentRetriever } from "@/server/retrieval/local-document-retriever";
import type { DocumentRetriever, RetrievedDocument } from "@/server/retrieval/types";
import {
  prioritizeEvidence,
  PROMPT_EVIDENCE_LIMIT,
  PROMPT_EXCERPT_LIMIT,
} from "@/lib/evidence-ranking";
import { identifyEntities } from "@/server/retrieval/graph-retriever";
import { ResilientGraphRetriever } from "@/server/retrieval/graph-retriever";
import type {
  GraphEntity,
  GraphNodeFact,
  GraphRelationshipFact,
  GraphRetriever,
} from "@/server/retrieval/graph-types";
import type {
  AgentTokenUsage,
  AgentToolName,
  AgenticEvidenceItem,
  AgenticToolCall,
} from "@/server/agentic-types";

// ---------------------------------------------------------------------------
// Investigation state — mutated in place by the orchestrator as tools run.
// ---------------------------------------------------------------------------

export type InvestigationState = {
  readonly question: string;
  /** Current reasoning objective, set by the planner and read by tools/prompts. */
  objective: string;
  entities: GraphEntity[];
  resolvedEntityNames: Set<string>;
  documents: RetrievedDocument[];
  graphNodes: Map<string, GraphNodeFact>;
  graphRelationships: GraphRelationshipFact[];
  traversalDepth: number;
  evidence: AgenticEvidenceItem[];
  /** Latest evidence-sufficiency assessment from the evaluate_evidence tool, if any. */
  latestAssessment: EvidenceAssessment | null;
  confidence: number | null;
  documentsSearched: number;
  documentStrategy: string | null;
  graphStrategy: string | null;
  graphFallbackMode: boolean;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export function createInvestigationState(question: string): InvestigationState {
  return {
    question,
    objective: "Understand the question and identify what evidence is needed to answer it.",
    entities: [],
    resolvedEntityNames: new Set(),
    documents: [],
    graphNodes: new Map(),
    graphRelationships: [],
    traversalDepth: 0,
    evidence: [],
    latestAssessment: null,
    confidence: null,
    documentsSearched: 0,
    documentStrategy: null,
    graphStrategy: null,
    graphFallbackMode: false,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function accumulateUsage(state: InvestigationState, usage: AgentTokenUsage | null): void {
  if (!usage) return;
  state.tokenUsage.promptTokens += usage.promptTokens ?? 0;
  state.tokenUsage.completionTokens += usage.completionTokens ?? 0;
  state.tokenUsage.totalTokens += usage.totalTokens ?? 0;
}

// ---------------------------------------------------------------------------
// Shared tool result shape.
// ---------------------------------------------------------------------------

export type ToolResult = {
  success: boolean;
  outputSummary: string;
  latencyMs: number;
  tokenUsage: AgentTokenUsage | null;
  evidenceAdded: AgenticEvidenceItem[];
  error?: string;
};

function toToolCall(
  iteration: number,
  tool: AgentToolName,
  input: Record<string, string | number>,
  result: ToolResult,
): AgenticToolCall {
  const call: AgenticToolCall = {
    iteration,
    tool,
    input,
    success: result.success,
    outputSummary: result.outputSummary,
    latencyMs: result.latencyMs,
    tokenUsage: result.tokenUsage,
    evidenceReturned: result.evidenceAdded.length,
  };
  if (result.error) call.error = result.error;
  return call;
}

// ---------------------------------------------------------------------------
// 1. extract_entities — Groq identifies key entities/concepts.
// ---------------------------------------------------------------------------

async function runExtractEntities(
  state: InvestigationState,
  plannedEntities?: GraphEntity[],
): Promise<ToolResult> {
  const start = performance.now();
  try {
    if (state.entities.length > 0) {
      return {
        success: true,
        outputSummary: `Reused ${state.entities.length} previously identified entit${state.entities.length === 1 ? "y" : "ies"}: ${state.entities.map((entity) => entity.name).join(", ")}.`,
        latencyMs: performance.now() - start,
        tokenUsage: null,
        evidenceAdded: [],
      };
    }

    if (plannedEntities) {
      state.entities.push(...plannedEntities);
      return {
        success: true,
        outputSummary:
          plannedEntities.length > 0
            ? `Identified ${plannedEntities.length} entit${plannedEntities.length === 1 ? "y" : "ies"} from the planner response: ${plannedEntities.map((entity) => entity.name).join(", ")}.`
            : "No entities were extracted locally from the question.",
        latencyMs: performance.now() - start,
        tokenUsage: null,
        evidenceAdded: [],
      };
    }

    const { entities, latencyMs, tokenUsage } = await identifyEntities(state.question);
    const existingNames = new Set(state.entities.map((entity) => entity.name.toLowerCase()));
    const newEntities = entities.filter((entity) => !existingNames.has(entity.name.toLowerCase()));
    state.entities.push(...newEntities);

    return {
      success: true,
      outputSummary:
        entities.length > 0
          ? `Identified ${entities.length} entit${entities.length === 1 ? "y" : "ies"}: ${entities.map((e) => e.name).join(", ")}.`
          : "No entities could be identified from the question.",
      latencyMs,
      tokenUsage,
      evidenceAdded: [],
    };
  } catch (error) {
    return {
      success: false,
      outputSummary: "Entity extraction failed.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: error instanceof Error ? error.message : "Entity extraction failed unexpectedly.",
    };
  }
}

// ---------------------------------------------------------------------------
// 2. search_documents — real keyword retrieval over the local corpus.
// ---------------------------------------------------------------------------

const documentRetriever: DocumentRetriever = new LocalDocumentRetriever();
const DOCUMENT_TOP_K = 12;

function documentToEvidence(doc: RetrievedDocument): AgenticEvidenceItem {
  return {
    id: `doc-${doc.id}`,
    title: doc.title,
    excerpt: doc.content,
    kind: "document",
    score: doc.score,
  };
}

async function runSearchDocuments(state: InvestigationState): Promise<ToolResult> {
  const start = performance.now();
  const query = state.objective || state.question;
  try {
    const outcome = await documentRetriever.retrieve(query, DOCUMENT_TOP_K);
    state.documentStrategy = outcome.strategy;
    state.documentsSearched = outcome.documentsSearched;

    const knownIds = new Set(state.documents.map((d) => d.id));
    const newDocs = outcome.documents.filter((doc) => !knownIds.has(doc.id));
    state.documents.push(...newDocs);
    const evidenceAdded = newDocs.map(documentToEvidence);
    state.evidence.push(...evidenceAdded);

    return {
      success: true,
      outputSummary:
        newDocs.length > 0
          ? `Retrieved ${newDocs.length} document${newDocs.length === 1 ? "" : "s"} for "${query}".`
          : `No new documents found for "${query}".`,
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded,
    };
  } catch (error) {
    return {
      success: false,
      outputSummary: "Document retrieval failed.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: error instanceof Error ? error.message : "Document retrieval failed unexpectedly.",
    };
  }
}

// ---------------------------------------------------------------------------
// 3 & 4. search_graph / traverse_graph — live TigerGraph REST++ traversal,
// falling back to the explicitly-labeled local corpus graph only when live
// TigerGraph is unconfigured or a real auth/network request fails.
// ---------------------------------------------------------------------------

const graphRetriever: GraphRetriever = new ResilientGraphRetriever();

function nodeToEvidence(node: GraphNodeFact): AgenticEvidenceItem {
  const attributeText = Object.entries(node.attributes)
    .filter(([key]) => key !== "name" && key !== "title" && key !== "label" && key !== "text")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
  const documentText = typeof node.attributes["text"] === "string" ? node.attributes["text"] : "";
  return {
    id: `node-${node.id}`,
    title: `${node.label} (${node.vertexType})`,
    excerpt:
      (documentText ? documentText.slice(0, 1200) : "") ||
      attributeText ||
      `${node.vertexType} vertex "${node.label}" from the graph.`,
    kind: "node",
    score: null,
  };
}

function edgeToEvidence(edge: GraphRelationshipFact): AgenticEvidenceItem {
  return {
    id: `edge-${edge.sourceId}-${edge.edgeType}-${edge.targetId}`,
    title: `${edge.sourceLabel} → ${edge.edgeType} → ${edge.targetLabel}`,
    excerpt: `Graph relationship: ${edge.sourceLabel} (${edge.edgeType}) ${edge.targetLabel}.`,
    kind: "relationship",
    score: null,
  };
}

async function runGraphRetrieval(state: InvestigationState, depth: number): Promise<ToolResult> {
  const start = performance.now();
  if (state.entities.length === 0) {
    return {
      success: false,
      outputSummary: "No entities available to look up in the graph.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: "extract_entities must run before graph retrieval.",
    };
  }

  try {
    const outcome = await graphRetriever.retrieve(state.entities, depth);
    state.graphFallbackMode = !outcome.strategy.startsWith("tigergraph-");
    state.graphStrategy = outcome.strategy;
    state.traversalDepth = Math.max(state.traversalDepth, outcome.traversalDepth);
    for (const name of outcome.resolvedEntities) state.resolvedEntityNames.add(name);

    const newNodes: GraphNodeFact[] = [];
    for (const node of outcome.nodes) {
      if (!state.graphNodes.has(node.id)) {
        state.graphNodes.set(node.id, node);
        newNodes.push(node);
      }
    }
    const knownEdgeIds = new Set(
      state.graphRelationships.map((e) => `${e.sourceId}-${e.edgeType}-${e.targetId}`),
    );
    const newEdges = outcome.relationships.filter(
      (e) => !knownEdgeIds.has(`${e.sourceId}-${e.edgeType}-${e.targetId}`),
    );
    state.graphRelationships.push(...newEdges);

    const evidenceAdded = [...newEdges.map(edgeToEvidence), ...newNodes.map(nodeToEvidence)];
    state.evidence.push(...evidenceAdded);

    return {
      success: true,
      outputSummary:
        newNodes.length > 0 || newEdges.length > 0
          ? `Found ${newNodes.length} node(s) and ${newEdges.length} relationship(s) at depth ${depth} (${outcome.strategy}).`
          : `No new nodes or relationships found at depth ${depth} (${outcome.strategy}).`,
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded,
    };
  } catch (error) {
    return {
      success: false,
      outputSummary: "Graph retrieval failed.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: error instanceof Error ? error.message : "Graph retrieval failed unexpectedly.",
    };
  }
}

async function runSearchGraph(state: InvestigationState): Promise<ToolResult> {
  return runGraphRetrieval(state, 1);
}

async function runTraverseGraph(state: InvestigationState): Promise<ToolResult> {
  return runGraphRetrieval(state, Math.max(2, state.traversalDepth + 1));
}

// ---------------------------------------------------------------------------
// 5. evaluate_evidence — Groq assesses relevance, consistency, and
// coverage of the evidence gathered so far.
// ---------------------------------------------------------------------------

export type EvidenceAssessment = {
  sufficient: boolean;
  confidence: number;
  coverage: string;
  contradictions: string[];
  reasoning: string;
};

function buildEvidenceEvaluationPrompt(state: InvestigationState): string {
  const selectedEvidence = prioritizeEvidence(
    state.question,
    state.evidence,
    PROMPT_EVIDENCE_LIMIT,
  );
  const evidenceText =
    selectedEvidence.length > 0
      ? selectedEvidence
          .map(
            (item, index) =>
              `[${index + 1}] (${item.kind}) ${item.title}\n${item.excerpt.slice(0, PROMPT_EXCERPT_LIMIT)}`,
          )
          .join("\n\n")
      : "(no evidence gathered yet)";

  return [
    "You are evaluating whether the evidence gathered so far is sufficient to answer a research question.",
    "Consider: relevance to the question, source quality, internal consistency, whether the evidence directly supports an answer, any contradictions, and how much of the question it covers.",
    'Return ONLY a JSON object, no prose, no markdown fences: {"sufficient": boolean, "confidence": number between 0 and 1, "coverage": string (one short sentence), "contradictions": string[], "reasoning": string (one or two short sentences)}.',
    "",
    `Question: ${state.question}`,
    `Current objective: ${state.objective}`,
    `Relevant evidence selected: ${selectedEvidence.length} of ${state.evidence.length} gathered items.`,
    "",
    "Evidence gathered so far:",
    evidenceText,
    "",
    "JSON object:",
  ].join("\n");
}

function parseAssessment(text: string): EvidenceAssessment {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Evidence evaluation did not return a JSON object.");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

  const sufficient = typeof parsed["sufficient"] === "boolean" ? parsed["sufficient"] : false;
  const rawConfidence = parsed["confidence"];
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0;
  const coverage = typeof parsed["coverage"] === "string" ? parsed["coverage"] : "";
  const contradictions = Array.isArray(parsed["contradictions"])
    ? (parsed["contradictions"] as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  const reasoning = typeof parsed["reasoning"] === "string" ? parsed["reasoning"] : "";

  return { sufficient, confidence, coverage, contradictions, reasoning };
}

async function runEvaluateEvidence(state: InvestigationState): Promise<ToolResult> {
  const start = performance.now();
  if (state.evidence.length === 0) {
    return {
      success: false,
      outputSummary: "No evidence gathered yet to evaluate.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: "evaluate_evidence requires at least one prior retrieval action.",
    };
  }

  try {
    const generation = await generateGroundedAnswer(buildEvidenceEvaluationPrompt(state));
    const assessment = parseAssessment(generation.text);
    state.latestAssessment = assessment;
    state.confidence = assessment.confidence;

    return {
      success: true,
      outputSummary:
        `Evidence ${assessment.sufficient ? "judged sufficient" : "judged insufficient"} (confidence ${Math.round(assessment.confidence * 100)}%). ${assessment.reasoning}`.trim(),
      latencyMs: performance.now() - start,
      tokenUsage: generation.usage,
      evidenceAdded: [],
    };
  } catch (error) {
    return {
      success: false,
      outputSummary: "Evidence evaluation failed.",
      latencyMs: performance.now() - start,
      tokenUsage: null,
      evidenceAdded: [],
      error: error instanceof Error ? error.message : "Evidence evaluation failed unexpectedly.",
    };
  }
}

export { GroqConfigError, GroqRequestError };

// ---------------------------------------------------------------------------
// Tool registry.
// ---------------------------------------------------------------------------

const TOOL_IMPLEMENTATIONS: Record<
  AgentToolName,
  (state: InvestigationState, plannedEntities?: GraphEntity[]) => Promise<ToolResult>
> = {
  extract_entities: runExtractEntities,
  search_documents: runSearchDocuments,
  search_graph: runSearchGraph,
  traverse_graph: runTraverseGraph,
  evaluate_evidence: runEvaluateEvidence,
};

export const TOOL_DESCRIPTIONS: Record<AgentToolName, string> = {
  extract_entities:
    "Use Groq to identify the key entities/concepts in the question. Run this before any graph tool.",
  search_documents:
    "Search the local document corpus for passages relevant to the current objective.",
  search_graph:
    "Look up the currently identified entities in the knowledge graph (1-hop). Requires extract_entities to have run first.",
  traverse_graph:
    "Expand the graph traversal one hop further from already-discovered entities/nodes to find indirect relationships. Requires search_graph to have found something first.",
  evaluate_evidence:
    "Use Groq to assess whether the evidence gathered so far is sufficient, consistent, and covers the question. Requires at least one prior retrieval action.",
};

/**
 * Executes a named tool against the shared investigation state, mutating
 * the state in place, and returns a structured trace-ready record. Never
 * throws — tool failures are captured as `success: false` records.
 */
export async function executeTool(
  iteration: number,
  tool: AgentToolName,
  state: InvestigationState,
  plannedEntities?: GraphEntity[],
): Promise<AgenticToolCall> {
  const input: Record<string, string | number> = { question: state.question };
  if (tool === "search_documents") input["query"] = state.objective || state.question;
  if (tool === "search_graph" || tool === "traverse_graph") {
    input["entities"] = state.entities.map((e) => e.name).join(", ") || "(none)";
  }

  const result = await TOOL_IMPLEMENTATIONS[tool](
    state,
    tool === "extract_entities" ? plannedEntities : undefined,
  );
  accumulateUsage(state, result.tokenUsage);
  return toToolCall(iteration, tool, input, result);
}
