export type ApproachId = "rag" | "graph" | "agentic";

export type Approach = {
  id: ApproachId;
  name: string;
  short: string;
  description: string;
  accent: "violet" | "cyan" | "indigo";
};

export const approaches: Approach[] = [
  {
    id: "rag",
    name: "RAG",
    short: "Direct retrieval",
    description: "Retrieve relevant documents and generate an answer.",
    accent: "cyan",
  },
  {
    id: "graph",
    name: "GraphRAG",
    short: "Connected reasoning",
    description: "Use entities and relationships to reason across connected information.",
    accent: "violet",
  },
  {
    id: "agentic",
    name: "Agentic GraphRAG",
    short: "Adaptive investigation",
    description: "Autonomously plan, investigate, evaluate evidence, and decide when to stop.",
    accent: "indigo",
  },
];

export const benchmark = [
  { approach: "RAG", accuracy: 72, completeness: 64, tokenEfficiency: 94, tokens: 2100, latency: 1.8, evidence: 61, steps: 3 },
  { approach: "GraphRAG", accuracy: 86, completeness: 84, tokenEfficiency: 78, tokens: 3400, latency: 3.1, evidence: 82, steps: 5 },
  { approach: "Agentic GraphRAG", accuracy: 92, completeness: 94, tokenEfficiency: 61, tokens: 4900, latency: 6.4, evidence: 93, steps: 9 },
];

export type ApproachResult = {
  id: ApproachId;
  name: string;
  answer: string;
  accuracy: number;
  completeness: number;
  evidenceQuality: number;
  tokens: number;
  latency: number;
  steps: number;
  sources: number[];
  entities: string[];
  relationships: string[];
  actions: string[];
};

export const investigationResults: Record<ApproachId, ApproachResult> = {
  rag: {
    id: "rag", name: "RAG",
    answer: "Company X changed strategy after the acquisition to expand its product offering using Company Y’s enterprise distribution capabilities.",
    accuracy: 72, completeness: 64, evidenceQuality: 61, tokens: 2100, latency: 1.8, steps: 3,
    sources: [0, 1], entities: ["Company X", "Company Y"], relationships: [],
    actions: ["Semantic search", "Chunk ranking", "Answer synthesis"],
  },
  graph: {
    id: "graph", name: "GraphRAG",
    answer: "The acquisition connected Company Y’s enterprise distribution network with Company X’s technology. That relationship enabled a platform strategy and directly supported the launch of Product Z.",
    accuracy: 86, completeness: 84, evidenceQuality: 82, tokens: 3400, latency: 3.1, steps: 5,
    sources: [0, 1, 2], entities: ["Company X", "Company Y", "Product Z", "Enterprise customers"],
    relationships: ["Company X → acquired → Company Y", "Company Y → provided → distribution network", "Combined capabilities → launched → Product Z"],
    actions: ["Entity extraction", "Relationship lookup", "Two-hop graph traversal", "Source retrieval", "Answer synthesis"],
  },
  agentic: {
    id: "agentic", name: "Agentic GraphRAG",
    answer: "Company X shifted because the acquisition exposed enterprise demand that its standalone model could not serve. It combined Company Y’s distribution with its own technology, then tested and validated the broader platform strategy through Product Z.",
    accuracy: 92, completeness: 94, evidenceQuality: 93, tokens: 4900, latency: 6.4, steps: 9,
    sources: [0, 1, 2, 3], entities: ["Company X", "Company Y", "Product Z", "Leadership team", "Enterprise customers"],
    relationships: ["Company X → acquired → Company Y", "Acquisition → revealed → enterprise demand", "Integrated capability → enabled → Product Z"],
    actions: ["Question decomposition", "Entity extraction", "Graph traversal", "Vector retrieval", "Evidence scoring", "Gap detection", "Targeted follow-up search", "Corroboration", "Cited synthesis"],
  },
};

export function getInvestigationResults(question: string): Record<ApproachId, ApproachResult> {
  const normalized = question.toLowerCase();
  const isAcquisitionQuestion = normalized.includes("acquir") || normalized.includes("strategy") || normalized.includes("company y");
  const isLeadershipQuestion = normalized.includes("leader") || normalized.includes("product z");
  if (isAcquisitionQuestion) return investigationResults;

  const subject = question.trim().replace(/[?.!]+$/, "");
  const answerLead = isLeadershipQuestion
    ? "The demo evidence indicates that leadership changes aligned enterprise feedback with Product Z’s platform roadmap"
    : `The current demo corpus provides limited direct evidence about “${subject}”`;

  return {
    rag: {
      ...investigationResults.rag,
      answer: isLeadershipQuestion
        ? `${answerLead}. Direct retrieval found the leadership interview, but did not establish the full relationship chain.`
        : `${answerLead}. RAG found related passages, but a reliable answer would require more directly relevant sources.`,
      accuracy: isLeadershipQuestion ? 76 : 58,
      completeness: isLeadershipQuestion ? 68 : 52,
    },
    graph: {
      ...investigationResults.graph,
      answer: isLeadershipQuestion
        ? `${answerLead}. The entity network connects the incoming product leader, enterprise feedback, and the revised launch plan.`
        : `${answerLead}. GraphRAG connected the available entities and relationships, while preserving the unresolved evidence gap.`,
      accuracy: isLeadershipQuestion ? 90 : 68,
      completeness: isLeadershipQuestion ? 89 : 64,
    },
    agentic: {
      ...investigationResults.agentic,
      answer: isLeadershipQuestion
        ? `${answerLead}. A follow-up retrieval corroborated that the new leader redirected Product Z toward workflow integration after reviewing enterprise interviews.`
        : `${answerLead}. The simulated agent checked the entity graph, evaluated the retrieved documents, and stopped without inventing unsupported facts.`,
      accuracy: isLeadershipQuestion ? 87 : 74,
      completeness: isLeadershipQuestion ? 86 : 72,
    },
  };
}

export const comparisonQuestions = [
  "Why did Company X change its strategy after acquiring Company Y?",
  "How did leadership changes influence Product Z?",
  "What did the acquisition brief say about Company Y?",
] as const;

export const traceSteps = [
  ["Question", "Mapped the question into strategy, acquisition, and product sub-questions."],
  ["Entity Identification", "Identified Company X, Company Y, Product Z, and the acquisition event."],
  ["Graph Traversal", "Traversed acquisition, leadership, and product-launch relationships."],
  ["Document Retrieval", "Found the strategy memo, acquisition brief, and launch review."],
  ["Evidence Evaluation", "Two sources corroborated the integration strategy."],
  ["Additional Investigation", "Detected a timing gap and searched leadership interviews and strategy notes."],
  ["Final Answer", "Found sufficient evidence and synthesized the causal chain with source-level citations."],
] as const;

export const evidence = [
  {
    title: "Company X FY24 Strategy Memo",
    type: "Internal memo",
    relevance: 96,
    confidence: 94,
    date: "2024-02-12",
    excerpt: "The acquisition accelerated a shift from a single-product model toward an integrated platform strategy.",
  },
  {
    title: "Company Y Acquisition Brief",
    type: "Transaction filing",
    relevance: 91,
    confidence: 97,
    date: "2023-11-08",
    excerpt: "Company Y contributed distribution infrastructure and an established enterprise customer base.",
  },
  {
    title: "Product Z Launch Review",
    type: "Market report",
    relevance: 87,
    confidence: 88,
    date: "2024-06-20",
    excerpt: "Product Z combined Company X technology with Company Y's enterprise delivery network.",
  },
  {
    title: "Leadership Interview: Platform Transition",
    type: "Interview transcript",
    relevance: 82,
    confidence: 84,
    date: "2024-04-03",
    excerpt: "The integration revealed demand for a broader workflow rather than another standalone tool.",
  },
];

export const comparisonResults = [
  {
    id: "rag" as const,
    answer: "Company X changed strategy to expand its product offering after gaining Company Y's capabilities.",
    sources: 3,
    retrieval: "8 chunks",
    tokens: "2.1k",
    score: 72, completeness: 64, evidenceQuality: 61, latency: 1.8, steps: 3,
    detail: "Directly retrieved documents",
  },
  {
    id: "graph" as const,
    answer: "The acquisition connected Company Y's distribution network with Company X's technology, enabling a platform strategy and Product Z.",
    sources: 5,
    retrieval: "2 graph paths",
    tokens: "3.4k",
    score: 86, completeness: 84, evidenceQuality: 82, latency: 3.1, steps: 5,
    detail: "Acquisition → capability → launch",
  },
  {
    id: "agentic" as const,
    answer: "Company X shifted because the acquisition exposed enterprise demand that its standalone model could not serve. It combined Company Y's distribution with its own technology, then validated the strategy through Product Z.",
    sources: 7,
    retrieval: "9 investigation steps",
    tokens: "4.9k",
    score: 92, completeness: 94, evidenceQuality: 93, latency: 6.4, steps: 9,
    detail: "Expanded inquiry after an evidence gap",
  },
];

export const alternateComparisonResults = comparisonResults.map((result) => ({
  ...result,
  answer: result.id === "rag"
    ? "The leadership change coincided with a revised Product Z launch plan."
    : result.id === "graph"
      ? "The incoming product leader connected enterprise feedback to Product Z’s platform roadmap."
      : "The new product leader synthesized enterprise interviews and launch evidence, then redirected Product Z toward workflow integration.",
  score: result.id === "rag" ? 76 : result.id === "graph" ? 91 : 88,
  completeness: result.id === "rag" ? 69 : result.id === "graph" ? 92 : 87,
  evidenceQuality: result.id === "rag" ? 66 : result.id === "graph" ? 91 : 88,
}));

export const directComparisonResults = comparisonResults.map((result) => ({
  ...result,
  answer: result.id === "rag"
    ? "The acquisition brief states that Company Y contributed distribution infrastructure and an established enterprise customer base."
    : result.id === "graph"
      ? "Company Y contributed distribution infrastructure and an enterprise customer base, linked to Company X through the acquisition."
      : "The evidence confirms that Company Y brought distribution infrastructure and an enterprise customer base; no further investigation was necessary.",
  score: result.id === "rag" ? 94 : result.id === "graph" ? 92 : 91,
  completeness: result.id === "rag" ? 93 : result.id === "graph" ? 91 : 90,
  evidenceQuality: result.id === "rag" ? 92 : result.id === "graph" ? 91 : 90,
}));

export const evidenceDiscoveries = [
  { step: "Initial retrieval", evidence: "Company Y Acquisition Brief", why: "Established the acquired distribution capability and transaction context.", status: "Evidence Found" },
  { step: "Graph traversal", evidence: "Product Z Launch Review", why: "Connected the acquisition to the integrated product launch through a two-hop path.", status: "Evidence Found" },
  { step: "Gap analysis", evidence: "Leadership Interview", why: "Explained why enterprise demand changed the timing and direction of the strategy.", status: "Evidence Found" },
  { step: "Evidence evaluation", evidence: "FY24 Strategy Memo", why: "Corroborated the causal explanation with an independent internal source.", status: "Completed" },
];

export const complexityData = [
  { label: "Simple", rag: 91, graph: 90, agentic: 89 },
  { label: "Relationship", rag: 73, graph: 89, agentic: 90 },
  { label: "Multi-hop", rag: 61, graph: 84, agentic: 91 },
  { label: "Investigation", rag: 54, graph: 75, agentic: 93 },
];