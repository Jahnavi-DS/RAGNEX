// SERVER-ONLY MODULE.
//
// Agentic GraphRAG orchestrator. Unlike src/server/approaches/rag.ts and
// src/server/approaches/graphrag.ts (which run a fixed retrieval sequence),
// this orchestrator evaluates the current investigation state on every
// iteration and asks Groq to decide the single most useful next action —
// or to stop and answer. Different questions can therefore take different
// investigation paths. See src/server/agentic/tools.ts for the tools it can
// call and src/server/agentic-types.ts for the result contract.

import { GroqConfigError, GroqRequestError, generateGroundedAnswer } from "@/server/groq";
import {
  prioritizeEvidence,
  PROMPT_EVIDENCE_LIMIT,
  PROMPT_EXCERPT_LIMIT,
} from "@/lib/evidence-ranking";
import {
  TOOL_DESCRIPTIONS,
  createInvestigationState,
  executeTool,
  type InvestigationState,
} from "@/server/agentic/tools";
import type {
  AgentAction,
  AgentToolName,
  AgenticEntity,
  AgenticEvidenceItem,
  AgenticLatency,
  AgenticProgressUpdate,
  AgenticRetrievalStats,
  AgenticRelationship,
  AgenticResult,
  AgenticStoppingReason,
  AgenticToolCall,
  AgenticTraceEvent,
} from "@/server/agentic-types";
import type { GraphEntity } from "@/server/retrieval/graph-types";

const ALL_TOOLS: AgentToolName[] = [
  "extract_entities",
  "search_documents",
  "search_graph",
  "traverse_graph",
  "evaluate_evidence",
];

function readMaxIterations(): number {
  const raw = Number(process.env["AGENTIC_MAX_ITERATIONS"]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
}

const MAX_AGENT_ITERATIONS = readMaxIterations();

// ---------------------------------------------------------------------------
// Planning — the agent decides what to do next given the current state.
// ---------------------------------------------------------------------------

type PlannerDecision = {
  action: AgentAction;
  objective: string;
  reason: string;
  entities: GraphEntity[] | null;
};

const PLANNER_ENTITY_LIMIT = 6;
const GENERIC_ENTITY_TERMS = new Set([
  "which",
  "olympic",
  "olympics",
  "event",
  "events",
  "games",
  "sport",
  "sports",
  "competition",
  "competitions",
  "venue",
  "venues",
  "held",
  "hosted",
  "where",
  "what",
  "when",
  "who",
]);

function parsePlannerEntities(value: unknown, question: string): GraphEntity[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const questionTerms = new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const entities: GraphEntity[] = [];
  const seenNames = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const name = typeof record["name"] === "string" ? record["name"].trim() : "";
    const rawType = record["type"];
    if (!name || (rawType !== undefined && rawType !== null && typeof rawType !== "string")) {
      return null;
    }

    const terms = [
      ...new Set(
        name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      ),
    ].filter((term) => term.length > 2 && !GENERIC_ENTITY_TERMS.has(term));
    const matchedTerms = terms.filter((term) => questionTerms.has(term)).length;
    if (terms.length === 0 || matchedTerms === 0 || matchedTerms / terms.length < 0.75) {
      return null;
    }

    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    const entityType = typeof rawType === "string" ? rawType.trim() : "";
    entities.push({ name, type: entityType || null });
  }

  return entities.length > 0 ? entities.slice(0, PLANNER_ENTITY_LIMIT) : null;
}

function summarizeState(state: InvestigationState, usedTools: AgentToolName[]): string {
  const lines: string[] = [];
  lines.push(
    `Entities identified: ${state.entities.length > 0 ? state.entities.map((e) => `${e.name}${e.type ? ` (${e.type})` : ""}${state.resolvedEntityNames.has(e.name) ? " [resolved in graph]" : ""}`).join(", ") : "none yet"}`,
  );
  lines.push(`Documents retrieved: ${state.documents.length}`);
  lines.push(`Graph nodes discovered: ${state.graphNodes.size}`);
  lines.push(`Graph relationships discovered: ${state.graphRelationships.length}`);
  lines.push(`Total evidence items: ${state.evidence.length}`);
  lines.push(
    `Latest evidence assessment: ${
      state.latestAssessment
        ? `sufficient=${state.latestAssessment.sufficient}, confidence=${state.latestAssessment.confidence.toFixed(2)}, coverage="${state.latestAssessment.coverage}"${state.latestAssessment.contradictions.length > 0 ? `, contradictions=${state.latestAssessment.contradictions.join("; ")}` : ""}`
        : "not yet evaluated"
    }`,
  );
  lines.push(
    `Tools already used this investigation: ${usedTools.length > 0 ? usedTools.join(", ") : "none"}`,
  );
  return lines.join("\n");
}

function buildPlannerPrompt(
  state: InvestigationState,
  usedTools: AgentToolName[],
  iteration: number,
): string {
  const toolLines = ALL_TOOLS.map((tool) => `- "${tool}": ${TOOL_DESCRIPTIONS[tool]}`).join("\n");

  return [
    "You are the planning module of an autonomous GraphRAG research agent investigating a question.",
    "On each turn you choose exactly ONE next action based on the current investigation state — never a fixed sequence. Pick whatever is actually most useful right now, and skip tools that would not add anything new.",
    "",
    "Available actions:",
    toolLines,
    '- "generate_answer": stop investigating and write the final answer, because the evidence gathered is sufficient (or because no further action would help).',
    'When choosing "extract_entities", include an optional "entities" array of objects with a non-empty "name" and a short lowercase "type" or null, grounded in the question. Omit it if you cannot confidently identify entities.',
    "",
    `Question: ${state.question}`,
    "",
    "Current investigation state:",
    summarizeState(state, usedTools),
    "",
    `Iteration ${iteration + 1} of at most ${MAX_AGENT_ITERATIONS}.`,
    "",
    "Decide the next action. Do not choose search_graph or traverse_graph before entities have been extracted. Do not choose evaluate_evidence before any documents or graph facts have been retrieved. Do not choose generate_answer before at least one retrieval action has run, unless no retrieval action could plausibly help.",
    'Return ONLY a JSON object, no prose, no markdown fences, with required string fields "action", "objective", and "reason". When action is "extract_entities", optionally include an "entities" array whose items have a non-empty string "name" and a "type" that is a short lowercase string or null. Include only entities grounded in the question; omit the field if uncertain.',
    "",
    "JSON object:",
  ].join("\n");
}

function parsePlannerDecision(text: string, question: string): PlannerDecision | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const rawAction = record["action"];
  const validActions: AgentAction[] = [...ALL_TOOLS, "generate_answer"];
  const action =
    typeof rawAction === "string" && (validActions as string[]).includes(rawAction)
      ? (rawAction as AgentAction)
      : null;
  if (!action) return null;

  const objective = typeof record["objective"] === "string" ? record["objective"] : "";
  const reason = typeof record["reason"] === "string" ? record["reason"] : "";
  const entities =
    action === "extract_entities" ? parsePlannerEntities(record["entities"], question) : null;
  return { action, objective, reason, entities };
}

function extractLocalEntities(question: string): GraphEntity[] {
  const entities: GraphEntity[] = [];
  const seen = new Set<string>();
  const add = (name: string, type: string) => {
    const normalized = normalizeWhitespace(name);
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      entities.push({ name: normalized, type });
    }
  };

  const games = question.match(/\b\d{4}\s+(?:summer|winter)\s+olympics\b/i)?.[0];
  if (games) add(games, "games");

  const category = question.match(/\b(?:women's|men's|women|men)\s+\d+\s*kg(?:\s+[a-z][a-z-]*)?/i)?.[0];
  if (category) add(category, "event");

  const sports = [
    "archery", "athletics", "badminton", "boxing", "canoe", "cycling", "diving",
    "fencing", "football", "gymnastics", "handball", "hockey", "judo", "rowing",
    "sailing", "shooting", "swimming", "taekwondo", "tennis", "volleyball", "wrestling",
  ];
  for (const sport of sports) {
    if (new RegExp(`\\b${sport}\\b`, "i").test(question)) add(sport, "sport");
  }

  const venue = question.match(/\bheld\s+(?:at|in)\s+(?:the\s+)?([A-Z][A-Za-z0-9' -]+?)(?=\s+(?:during|for|on)|[?.!,]|$)/i)?.[1];
  if (venue && !/\b(?:summer|winter)\s+olympics\b/i.test(venue)) add(venue, "venue");

  const medal = question.match(/\b(gold|silver|bronze)\s+medal\b/i)?.[1];
  if (medal) add(`${medal} medal`, "medal");
  if (/\b(?:winner|won)\b/i.test(question)) add("winner", "outcome");

  return entities.slice(0, PLANNER_ENTITY_LIMIT);
}

function planLocally(state: InvestigationState, usedTools: AgentToolName[]): PlannerDecision {
  const reason = "local_entity_fallback: continuing the investigation without further Groq calls.";
  if (!usedTools.includes("extract_entities")) {
    return {
      action: "extract_entities",
      objective: state.question,
      reason,
      entities: extractLocalEntities(state.question),
    };
  }
  if (!usedTools.includes("search_documents")) {
    return { action: "search_documents", objective: state.question, reason, entities: null };
  }
  if (!usedTools.includes("search_graph")) {
    return { action: "search_graph", objective: state.question, reason, entities: null };
  }
  if (state.evidence.length > 0 && !usedTools.includes("evaluate_evidence")) {
    return { action: "evaluate_evidence", objective: state.question, reason, entities: null };
  }
  if (state.graphNodes.size > 0 && !usedTools.includes("traverse_graph")) {
    return { action: "traverse_graph", objective: state.question, reason, entities: null };
  }
  return { action: "generate_answer", objective: state.question, reason, entities: null };
}

async function planNextAction(
  state: InvestigationState,
  usedTools: AgentToolName[],
  iteration: number,
): Promise<{
  decision: PlannerDecision;
  latencyMs: number;
  tokenUsage: AgenticToolCall["tokenUsage"];
}> {
  const start = performance.now();
  const generation = await generateGroundedAnswer(buildPlannerPrompt(state, usedTools, iteration));
  const decision = parsePlannerDecision(generation.text, state.question);
  if (!decision) throw new Error("Agent planner returned malformed or invalid action JSON.");
  return { decision, latencyMs: performance.now() - start, tokenUsage: generation.usage };
}

// ---------------------------------------------------------------------------
// Final answer generation.
// ---------------------------------------------------------------------------

function buildFinalAnswerPrompt(
  state: InvestigationState,
  evidence: AgenticEvidenceItem[],
): string {
  const selectedEvidence = evidence.slice(0, PROMPT_EVIDENCE_LIMIT);
  const context =
    selectedEvidence.length > 0
      ? selectedEvidence
          .map(
            (item, index) =>
              `[${index + 1}] (${item.kind}) ${item.title}\n${item.excerpt.slice(0, PROMPT_EXCERPT_LIMIT)}`,
          )
          .join("\n\n")
      : "(no evidence was gathered)";

  return [
    "You are a research assistant answering strictly from the evidence gathered during an autonomous investigation.",
    "Only use facts from the evidence below. If the evidence does not contain enough information to answer, say so explicitly instead of guessing.",
    "Cite evidence inline using its bracketed number, e.g. [1].",
    "",
    "Evidence gathered:",
    context,
    "",
    `Question: ${state.question}`,
    "",
    "Answer:",
  ].join("\n");
}

const FALLBACK_PREFIX = "fallback_local_evidence";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractQuestionVenue(question: string): string | null {
  const match = question.match(/(?:at|in|held at|held in)\s+([A-Z][A-Za-z0-9' .-]+?)(?:\s+(?:during|for|at|in)|$)/i);
  return match && match[1] ? normalizeWhitespace(match[1]) : null;
}

function extractQuestionGames(question: string): string | null {
  const match = question.match(/(\d{4}\s+Summer\s+Olympics|\d{4}\s+summer\s+Olympics|\d{4}\s+Summer\s+Games|\d{4}\s+summer\s+games|Summer\s+Olympics|summer\s+Olympics)/i);
  return match && match[1] ? normalizeWhitespace(match[1]) : null;
}

function extractCandidateValues(text: string, labels: string[]): string[] {
  const normalized = text.replace(/\s+/g, " ");
  const matches = labels.flatMap((label) => {
    const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\-]?\\s*([A-Z][A-Za-z0-9' .,-]+?(?=(?:\\s*(?:;|\.|$)|\\s*(?:,|\)|\]|\n))))`, "i");
    const results: string[] = [];
    const all = normalized.matchAll(pattern);
    for (const match of all) {
      const candidate = normalizeWhitespace(match[1] ?? "");
      if (candidate) results.push(candidate);
    }
    return results;
  });
  return [...new Set(matches.map((m) => m.replace(/[\s,;]+$/, "")))];
}

function scoreEvidenceMatch(question: string, evidenceText: string): number {
  const haystack = evidenceText.toLowerCase();
  const needleTerms = new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !["which", "what", "where", "who", "when", "the", "were", "held", "gold", "event", "events", "olympic", "summer", "olympics", "games"].includes(term)),
  );
  return [...needleTerms].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function hasStrongEvidence(state: InvestigationState): boolean {
  if (state.evidence.length === 0) return false;
  const score = state.evidence.reduce(
    (total, item) => total + scoreEvidenceMatch(state.question, `${item.title} ${item.excerpt}`),
    0,
  );
  return score >= 2 || state.evidence.length >= 3;
}

function extractListAnswer(question: string, evidence: AgenticEvidenceItem[]): string | null {
  const venue = extractQuestionVenue(question) ?? "the relevant venue";
  const games = extractQuestionGames(question) ?? "the relevant Olympic games";
  const names = evidence.flatMap((item) => {
    const text = `${item.title} ${item.excerpt}`;
    if (!text.match(new RegExp(venue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))) return [];
    if (games && !text.match(new RegExp(games.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))) return [];
    const title = normalizeWhitespace(item.title);
    if (!title || /^(document|graph|relationship|node)$/i.test(title)) return [];
    return [title];
  });
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length > 0) return `The gathered evidence indicates these events were held at ${venue} during ${games}: ${uniqueNames.join("; ")}.`;
  return null;
}

function extractWinnerAnswer(question: string, evidence: AgenticEvidenceItem[]): string | null {
  const relevantEvidence = evidence.filter((item) => {
    const text = `${item.kind === "document" ? item.title : `${item.title} ${item.excerpt}`}`.toLowerCase();
    const sport = [
      "archery", "athletics", "badminton", "boxing", "canoe", "cycling", "diving",
      "fencing", "football", "gymnastics", "handball", "hockey", "judo", "rowing",
      "sailing", "shooting", "swimming", "taekwondo", "tennis", "volleyball", "wrestling",
    ].find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(question));
    const year = question.match(/\b\d{4}\b/)?.[0];
    const weight = question.match(/\b\d+\s*kg\b/i)?.[0]?.replace(/\s+/g, "\\s*");
    return (!sport || text.includes(sport)) &&
      (!year || text.includes(year)) &&
      (!weight || new RegExp(weight, "i").test(text));
  });
  const fieldCandidates = relevantEvidence.flatMap((item) => {
    const text = `${item.title}\n${item.excerpt}`;
    return [...text.matchAll(/\bgold\s*:\s*([^\r\n]+)/gi)]
      .map((match) =>
        normalizeWhitespace(match[1] ?? "")
          .replace(/\s+(?:goldNOC|silver|bronze|prev|next)\s*:.*$/i, "")
          .replace(/[\s,;:.]+$/, ""),
      )
      .filter(Boolean);
  });
  const candidates = fieldCandidates;
  const winner = [...new Set(candidates.filter((value) => !/\b(?:medal|winner|gold)\b/i.test(value)))][0];
  if (winner) return `The gathered evidence shows the gold medal winner was ${winner}.`;
  return null;
}

function extractLocationAnswer(question: string, evidence: AgenticEvidenceItem[]): string | null {
  const eventTarget = question.match(/(?:the\s+)?([A-Za-z0-9' .-]+)\s+event/i)?.[1]?.trim();
  const venueCandidates = evidence.flatMap((item) => {
    const text = `${item.title} ${item.excerpt}`;
    const matches = extractCandidateValues(text, ["venue", "held at", "held in", "location"]);
    if (eventTarget && !text.toLowerCase().includes(eventTarget.toLowerCase())) return [];
    return matches;
  });
  const venue = [...new Set(venueCandidates)][0];
  if (venue) return `The gathered evidence indicates the event was held at ${venue}.`;
  return null;
}

function buildFallbackLocalAnswer(question: string, evidence: AgenticEvidenceItem[]): string {
  const q = question.toLowerCase();
  if (/(which|what).*?(event|events|medal|medals).*(held|held at|held in|were held)/i.test(question) || /which.*events.*at/i.test(question)) {
    const answer = extractListAnswer(question, evidence);
    if (answer) return answer;
    return "The gathered evidence is sufficient to identify the relevant venue and games, but it does not include all event names in the retrieved excerpts.";
  }
  if (/(who).*(gold|won|winner)/i.test(question) || /gold medal.*who/i.test(question)) {
    const answer = extractWinnerAnswer(question, evidence);
    if (answer) return answer;
    return "The gathered evidence is sufficient to show a gold-medal result, but the winner field is not clearly stated in the retrieved excerpts.";
  }
  if (/\bwhere\b/i.test(question) || /held at|held in|venue/i.test(question)) {
    const answer = extractLocationAnswer(question, evidence);
    if (answer) return answer;
    return "The gathered evidence is sufficient to show a venue relationship, but the exact location field is not clearly stated in the retrieved excerpts.";
  }
  return "The gathered evidence supports a direct answer, but the question type does not match the deterministic local fallback patterns.";
}

// ---------------------------------------------------------------------------
// Main investigation loop.
// ---------------------------------------------------------------------------

function emptyLatency(): AgenticLatency {
  return { planningMs: 0, toolMs: 0, generationMs: null, totalMs: 0 };
}

function toEntities(state: InvestigationState): AgenticEntity[] {
  return state.entities.map((entity) => ({
    name: entity.name,
    type: entity.type,
    resolved: state.resolvedEntityNames.has(entity.name),
  }));
}

function toRelationships(state: InvestigationState): AgenticRelationship[] {
  return state.graphRelationships.map((edge) => ({
    source: edge.sourceLabel,
    relation: edge.edgeType,
    target: edge.targetLabel,
  }));
}

function getRetrievalStats(state: InvestigationState): AgenticRetrievalStats {
  return {
    graphStrategy: state.graphStrategy ?? "not-used",
    documentStrategy: state.documentStrategy ?? "not-used",
    entitiesQueried: state.entities.length,
    entitiesResolved: state.resolvedEntityNames.size,
    documentsRetrieved: state.documents.length,
    nodesDiscovered: state.graphNodes.size,
    relationshipsDiscovered: state.graphRelationships.length,
    maxTraversalDepth: state.traversalDepth,
  };
}

function getFailureContext(state: InvestigationState) {
  return {
    confidence: state.confidence,
    evidence: prioritizeEvidence(state.question, state.evidence),
    entities: toEntities(state),
    relationships: toRelationships(state),
    retrieval: getRetrievalStats(state),
    tokens: state.tokenUsage,
    graphFallbackMode: state.graphFallbackMode,
  };
}

/**
 * Runs the bounded agentic investigation loop: on each iteration, ask the
 * planner to inspect the current state and choose the single next action
 * (a tool, or "generate_answer" to stop). Executes that action, updates
 * state, and repeats until the agent chooses to stop, a stopping condition
 * is met, or MAX_AGENT_ITERATIONS is reached. Never throws — failures are
 * returned as an AgenticErrorResult.
 */
export async function runAgenticInvestigation(
  rawQuestion: string,
  onProgress?: (update: AgenticProgressUpdate) => void,
): Promise<AgenticResult> {
  const startedAt = performance.now();
  const question = rawQuestion.trim();

  if (!question) {
    onProgress?.({
      questionAccepted: false,
      activeAction: null,
      toolCalls: [],
      finalAnswerState: "pending",
    });
    return {
      status: "error",
      question,
      code: "invalid_question",
      message: "Please enter a question before running the investigation.",
      trace: [],
      toolCalls: [],
      iterations: 0,
      latency: emptyLatency(),
    };
  }

  const state = createInvestigationState(question);
  const trace: AgenticTraceEvent[] = [];
  const toolCalls: AgenticToolCall[] = [];
  const usedTools: AgentToolName[] = [];
  let finalAnswerState: AgenticProgressUpdate["finalAnswerState"] = "pending";

  const publishProgress = (
    activeAction: AgenticProgressUpdate["activeAction"],
    nextFinalAnswerState = finalAnswerState,
  ) => {
    finalAnswerState = nextFinalAnswerState;
    onProgress?.({
      questionAccepted: true,
      activeAction,
      toolCalls: toolCalls.map(({ tool, success, evidenceReturned }) => ({
        tool,
        success,
        evidenceReturned,
      })),
      finalAnswerState,
    });
  };

  publishProgress(null);

  let planningMs = 0;
  let toolMs = 0;
  let stoppingReason: AgenticStoppingReason | null = null;
  let iteration = 0;
  let consecutiveUnproductive = 0;
  let localPlannerFallback = false;

  for (; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    let planning: Awaited<ReturnType<typeof planNextAction>>;
    if (localPlannerFallback) {
      planning = {
        decision: planLocally(state, usedTools),
        latencyMs: 0,
        tokenUsage: null,
      };
    } else {
      const planningStartedAt = performance.now();
      try {
        planning = await planNextAction(state, usedTools, iteration);
      } catch (error) {
        const latency: AgenticLatency = {
          planningMs,
          toolMs,
          generationMs: null,
          totalMs: performance.now() - startedAt,
        };
        if (
          error instanceof GroqRequestError &&
          /429|rate limit/i.test(error.message)
        ) {
          localPlannerFallback = true;
          planning = {
            decision: {
              action: "extract_entities",
              objective: question,
              reason:
                "local_entity_fallback: Groq HTTP 429 rate-limited the planner; extracting question entities locally and continuing without another Groq call.",
              entities: extractLocalEntities(question),
            },
            latencyMs: performance.now() - planningStartedAt,
            tokenUsage: null,
          };
        } else {
          if (error instanceof GroqConfigError || error instanceof GroqRequestError) {
            publishProgress(null, "failed");
            return {
              status: "error",
              question,
              code: error instanceof GroqConfigError ? "missing_api_key" : "groq_error",
              message: error.message,
              trace,
              toolCalls,
              iterations: iteration,
              latency,
              ...getFailureContext(state),
            };
          }
          return {
            status: "error",
            question,
            code: "planning_failed",
            message: error instanceof Error ? error.message : "Agent planning failed unexpectedly.",
            trace,
            toolCalls,
            iterations: iteration,
            latency,
            ...getFailureContext(state),
          };
        }
      }
    }
    planningMs += planning.latencyMs;
    if (planning.tokenUsage) {
      state.tokenUsage.promptTokens += planning.tokenUsage.promptTokens ?? 0;
      state.tokenUsage.completionTokens += planning.tokenUsage.completionTokens ?? 0;
      state.tokenUsage.totalTokens += planning.tokenUsage.totalTokens ?? 0;
    }
    state.objective = planning.decision.objective || state.objective;

    const confidenceBefore = state.confidence;

    if (planning.decision.action === "generate_answer") {
      if (state.evidence.length === 0) {
        const message = "Agent planner selected answer generation before gathering any evidence.";
        trace.push({
          iteration,
          objective: state.objective,
          action: "generate_answer",
          reason: planning.decision.reason || message,
          toolCall: null,
          confidenceBefore,
          confidenceAfter: state.confidence,
          evidenceCountAfter: 0,
        });
        publishProgress(null, "failed");
        return {
          status: "error",
          question,
          code: "planning_failed",
          message,
          trace,
          toolCalls,
          iterations: trace.length,
          latency: {
            planningMs,
            toolMs,
            generationMs: null,
            totalMs: performance.now() - startedAt,
          },
          ...getFailureContext(state),
        };
      }
      stoppingReason = state.latestAssessment?.sufficient
        ? "sufficient_evidence"
        : state.confidence !== null && state.confidence >= 0.75
          ? "high_confidence"
          : state.evidence.length > 0
            ? "question_answered"
            : "insufficient_evidence";
      trace.push({
        iteration,
        objective: state.objective,
        action: "generate_answer",
        reason: planning.decision.reason || "Agent determined investigation is complete.",
        toolCall: null,
        confidenceBefore,
        confidenceAfter: state.confidence,
        evidenceCountAfter: state.evidence.length,
      });
      break;
    }

    const tool = planning.decision.action;
    publishProgress(tool);
    let toolCall: AgenticToolCall;
    if (localPlannerFallback && tool === "evaluate_evidence") {
      const sufficient = hasStrongEvidence(state);
      state.latestAssessment = {
        sufficient,
        confidence: sufficient ? Math.max(state.confidence ?? 0.7, 0.7) : state.confidence ?? 0.4,
        coverage: sufficient
          ? "Strong direct evidence already exists for the question."
          : "The locally retrieved evidence may not fully cover the question.",
        contradictions: [],
        reasoning: "Evidence was assessed locally because Groq had already rate-limited the investigation.",
      };
      state.confidence = state.latestAssessment.confidence;
      toolCall = {
        iteration,
        tool,
        input: { question, fallback: "local_entity_fallback" },
        success: true,
        outputSummary: `local_entity_fallback: evidence assessed locally as ${sufficient ? "sufficient" : "incomplete"}.`,
        latencyMs: 0,
        tokenUsage: null,
        evidenceReturned: 0,
      };
    } else {
      toolCall = await executeTool(
        iteration,
        tool,
        state,
        planning.decision.entities ?? undefined,
      );
      if (localPlannerFallback && tool === "extract_entities") {
        toolCall.input["fallback"] = "local_entity_fallback";
        toolCall.outputSummary = `local_entity_fallback: ${toolCall.outputSummary}`;
      }
    }
    toolMs += toolCall.latencyMs;
    toolCalls.push(toolCall);
    usedTools.push(tool);

    if (!toolCall.success || toolCall.evidenceReturned === 0) {
      consecutiveUnproductive += 1;
    } else {
      consecutiveUnproductive = 0;
    }

    trace.push({
      iteration,
      objective: state.objective,
      action: tool,
      reason: planning.decision.reason || `Selected ${tool} based on the current state.`,
      toolCall,
      confidenceBefore,
      confidenceAfter: state.confidence,
      evidenceCountAfter: state.evidence.length,
    });
    publishProgress(null);

    if (!toolCall.success && tool === "evaluate_evidence") {
      if (hasStrongEvidence(state)) {
        state.latestAssessment = {
          sufficient: true,
          confidence: Math.max(state.confidence ?? 0.7, 0.7),
          coverage: "Strong direct evidence already exists for the question.",
          contradictions: [],
          reasoning:
            "The evaluation tool failed, but the retrieved documents and graph facts already directly support a complete answer.",
        };
        state.confidence = state.latestAssessment.confidence;
        stoppingReason = "sufficient_evidence";
        trace.push({
          iteration,
          objective: state.objective,
          action: "generate_answer",
          reason:
            "evaluate_evidence failed, but the investigation already gathered strong direct evidence; proceeding to a local fallback answer.",
          toolCall: null,
          confidenceBefore,
          confidenceAfter: state.confidence,
          evidenceCountAfter: state.evidence.length,
        });
        break;
      }

      const message = toolCall.error ?? `${tool} failed.`;
      const code = message.includes("Groq API key")
        ? "missing_api_key"
        : message.includes("Groq")
          ? "groq_error"
          : "tool_failure";
      publishProgress(null, "failed");
      return {
        status: "error",
        question,
        code,
        message,
        trace,
        toolCalls,
        iterations: trace.length,
        latency: { planningMs, toolMs, generationMs: null, totalMs: performance.now() - startedAt },
        ...getFailureContext(state),
      };
    }

    if (!toolCall.success && tool === "extract_entities") {
      const message = toolCall.error ?? `${tool} failed.`;
      const code = message.includes("Groq API key")
        ? "missing_api_key"
        : message.includes("Groq")
          ? "groq_error"
          : "tool_failure";
      publishProgress(null, "failed");
      return {
        status: "error",
        question,
        code,
        message,
        trace,
        toolCalls,
        iterations: trace.length,
        latency: { planningMs, toolMs, generationMs: null, totalMs: performance.now() - startedAt },
        ...getFailureContext(state),
      };
    }

    if (!toolCall.success && (tool === "search_documents" || tool === "search_graph")) {
      // A core retrieval tool failing outright (not just "found nothing")
      // signals infrastructure trouble worth surfacing rather than masking
      // with further iterations.
      if (state.evidence.length === 0) {
        stoppingReason = "retrieval_failure";
        break;
      }
    }

    if (tool === "evaluate_evidence" && state.latestAssessment?.sufficient) {
      stoppingReason = "sufficient_evidence";
      break;
    }

    if (consecutiveUnproductive >= 3) {
      stoppingReason = "no_useful_next_action";
      break;
    }
  }

  if (!stoppingReason) {
    stoppingReason = "max_iterations_reached";
  }

  const iterationsRun =
    trace.length > 0 ? (trace[trace.length - 1]?.iteration ?? iteration) + 1 : 0;

  if (state.evidence.length === 0) {
    const failedCall = [...toolCalls].reverse().find((call) => !call.success);
    return {
      status: "error",
      question,
      code: failedCall ? "tool_failure" : "no_evidence",
      message:
        failedCall?.error ??
        "The agent could not gather evidence from documents or the live graph.",
      trace,
      toolCalls,
      iterations: iterationsRun,
      latency: { planningMs, toolMs, generationMs: null, totalMs: performance.now() - startedAt },
      ...getFailureContext(state),
    };
  }

  try {
    const evidence = prioritizeEvidence(state.question, state.evidence);
    publishProgress("generate_answer", "in_progress");
    if (localPlannerFallback) {
      const totalMs = performance.now() - startedAt;
      publishProgress(null, "completed");
      return {
        status: "success",
        question,
        answer: `${FALLBACK_PREFIX}: ${buildFallbackLocalAnswer(question, evidence)}`,
        answerSource: "fallback_local_evidence",
        confidence: state.latestAssessment?.confidence ?? (hasStrongEvidence(state) ? 0.7 : 0.45),
        evidence,
        sources: evidence,
        entities: toEntities(state),
        relationships: toRelationships(state),
        trace,
        toolCalls,
        iterations: iterationsRun,
        stoppingReason: stoppingReason ?? "question_answered",
        retrieval: getRetrievalStats(state),
        tokens: state.tokenUsage,
        latency: { planningMs, toolMs, generationMs: null, totalMs },
        model: "local-evidence-fallback",
        graphFallbackMode: state.graphFallbackMode,
      };
    }
    const generation = await generateGroundedAnswer(buildFinalAnswerPrompt(state, evidence));
    const totalMs = performance.now() - startedAt;
    const tokens = {
      promptTokens: state.tokenUsage.promptTokens + (generation.usage.promptTokens ?? 0),
      completionTokens:
        state.tokenUsage.completionTokens + (generation.usage.completionTokens ?? 0),
      totalTokens: state.tokenUsage.totalTokens + (generation.usage.totalTokens ?? 0),
    };

    publishProgress(null, "completed");
    return {
      status: "success",
      question,
      answer: generation.text,
      answerSource: "groq",
      confidence: state.confidence,
      evidence,
      sources: evidence,
      entities: toEntities(state),
      relationships: toRelationships(state),
      trace,
      toolCalls,
      iterations: iterationsRun,
      stoppingReason,
      retrieval: getRetrievalStats(state),
      tokens,
      latency: { planningMs, toolMs, generationMs: generation.latencyMs, totalMs },
      model: generation.model,
      graphFallbackMode: state.graphFallbackMode,
    };
  } catch (error) {
    const evidence = prioritizeEvidence(state.question, state.evidence);
    const fallbackAllowed =
      error instanceof GroqRequestError && /429|rate limit/i.test(error.message) && evidence.length > 0;

    if (fallbackAllowed && hasStrongEvidence(state)) {
      const fallbackAnswer = buildFallbackLocalAnswer(question, evidence);
      const totalMs = performance.now() - startedAt;
      const tokens = {
        promptTokens: state.tokenUsage.promptTokens,
        completionTokens: state.tokenUsage.completionTokens,
        totalTokens: state.tokenUsage.totalTokens,
      };
      publishProgress(null, "completed");
      return {
        status: "success",
        question,
        answer: `${FALLBACK_PREFIX}: ${fallbackAnswer}`,
        answerSource: "fallback_local_evidence",
        confidence: Math.max(state.confidence ?? 0.65, 0.65),
        evidence,
        sources: evidence,
        entities: toEntities(state),
        relationships: toRelationships(state),
        trace,
        toolCalls,
        iterations: iterationsRun,
        stoppingReason: stoppingReason ?? "sufficient_evidence",
        retrieval: getRetrievalStats(state),
        tokens,
        latency: {
          planningMs,
          toolMs,
          generationMs: null,
          totalMs,
        },
        model: "local-evidence-fallback",
        graphFallbackMode: state.graphFallbackMode,
      };
    }

    const latency: AgenticLatency = {
      planningMs,
      toolMs,
      generationMs: null,
      totalMs: performance.now() - startedAt,
    };
    publishProgress(null, "failed");
    return {
      status: "error",
      question,
      code:
        error instanceof GroqConfigError
          ? "missing_api_key"
          : error instanceof GroqRequestError
            ? "groq_error"
            : "unknown",
      message:
        error instanceof Error ? error.message : "Agentic GraphRAG execution failed unexpectedly.",
      trace,
      toolCalls,
      iterations: iterationsRun,
      latency,
      ...getFailureContext(state),
    };
  }
}
