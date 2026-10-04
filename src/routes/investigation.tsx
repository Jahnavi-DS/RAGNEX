import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  GitBranch,
  LoaderCircle,
  MinusCircle,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  ApproachIcon,
  PageShell,
  QuestionInput,
  SampleNotice,
  SectionLabel,
} from "@/components/lab";
import { Button } from "@/components/ui/button";
import type { ApproachId } from "@/lib/demo-data";
import { runRagFn } from "@/functions/run-rag";
import { runGraphRagFn } from "@/functions/run-graphrag";
import { getAgenticProgressFn, runAgenticGraphRagFn } from "@/functions/run-agentic-graphrag";
import type { RagResult } from "@/server/rag-types";
import type { GraphRagResult } from "@/server/graphrag-types";
import { prioritizeEvidence } from "@/lib/evidence-ranking";
import type {
  AgenticProgressSnapshot,
  AgenticProgressToolCall,
  AgenticResult,
} from "@/server/agentic-types";

export const Route = createFileRoute("/investigation")({
  head: () => ({
    meta: [
      { title: "Investigation | RAGNEX" },
      {
        name: "description",
        content:
          "Run the same question through RAG, GraphRAG, and Agentic GraphRAG workflows in RAGNEX.",
      },
      { property: "og:title", content: "RAGNEX Investigation Workspace" },
      { property: "og:description", content: "Compare evidence-backed sample research workflows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvestigationPage,
});

function InvestigationPage() {
  const runningRef = useRef(false);
  const [selected, setSelected] = useState<ApproachId[]>(["rag", "graph", "agentic"]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<ApproachId[]>([]);
  const [question, setQuestion] = useState(
    "Which Olympic events were held at Eton Dorney during the 2012 Summer Olympics?",
  );
  const [running, setRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [ragResult, setRagResult] = useState<RagResult | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [graphResult, setGraphResult] = useState<GraphRagResult | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [agenticResult, setAgenticResult] = useState<AgenticResult | null>(null);
  const [agenticLoading, setAgenticLoading] = useState(false);
  const [agenticProgressId, setAgenticProgressId] = useState<string | null>(null);
  const [agenticProgress, setAgenticProgress] = useState<AgenticProgressSnapshot | null>(null);

  useEffect(() => {
    if (!agenticLoading || !agenticProgressId) return;
    let polling = false;
    const refreshProgress = async () => {
      if (polling) return;
      polling = true;
      try {
        const progress = await getAgenticProgressFn({ data: { progressId: agenticProgressId } });
        if (progress) setAgenticProgress(progress);
      } catch {
        // The final result still contains the authoritative tool trace.
      } finally {
        polling = false;
      }
    };
    void refreshProgress();
    const pollTimer = window.setInterval(() => void refreshProgress(), 250);
    return () => window.clearInterval(pollTimer);
  }, [agenticLoading, agenticProgressId]);

  useEffect(() => {
    if (completed.length > 0) {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [completed]);

  const run = (value: string) => {
    const acceptedQuestion = value.trim();
    if (!acceptedQuestion || runningRef.current) return;
    if (selected.length === 0) {
      setSelectionError("Select at least one approach to run.");
      return;
    }

    setSelectionError(null);
    runningRef.current = true;
    setQuestion(acceptedQuestion);
    setCompleted([...selected]);
    setShowProgress(true);
    setRunning(true);

    const requests: Array<() => Promise<void>> = [];
    if (selected.includes("rag")) {
      setRagResult(null);
      setRagLoading(true);
      requests.push(() =>
        runRagFn({ data: { question: acceptedQuestion } })
          .then((result) => setRagResult(result))
          .catch((error: unknown) =>
            setRagResult({
              status: "error",
              question: acceptedQuestion,
              code: "unknown",
              message:
                error instanceof Error ? error.message : "RAG execution failed unexpectedly.",
              latency: { retrievalMs: null, generationMs: null, totalMs: null },
            }),
          )
          .finally(() => setRagLoading(false)),
      );
    }
    if (selected.includes("graph")) {
      setGraphResult(null);
      setGraphLoading(true);
      requests.push(() =>
        runGraphRagFn({ data: { question: acceptedQuestion } })
          .then((result) => setGraphResult(result))
          .catch((error: unknown) =>
            setGraphResult({
              status: "error",
              question: acceptedQuestion,
              code: "unknown",
              message:
                error instanceof Error ? error.message : "GraphRAG execution failed unexpectedly.",
              latency: {
                entityExtractionMs: null,
                graphQueryMs: null,
                generationMs: null,
                totalMs: null,
              },
            }),
          )
          .finally(() => setGraphLoading(false)),
      );
    }
    if (selected.includes("agentic")) {
      const progressId = crypto.randomUUID();
      setAgenticResult(null);
      setAgenticLoading(true);
      setAgenticProgressId(progressId);
      setAgenticProgress(null);
      requests.push(() =>
        runAgenticGraphRagFn({ data: { question: acceptedQuestion, progressId } })
          .then((result) => setAgenticResult(result))
          .catch((error: unknown) =>
            setAgenticResult({
              status: "error",
              question: acceptedQuestion,
              code: "unknown",
              message:
                error instanceof Error
                  ? error.message
                  : "Agentic GraphRAG execution failed unexpectedly.",
              trace: [],
              toolCalls: [],
              iterations: 0,
              latency: { planningMs: 0, toolMs: 0, generationMs: null, totalMs: 0 },
            }),
          )
          .finally(() => setAgenticLoading(false)),
      );
    }
    const runRequests = async () => {
      for (const request of requests) await request();
    };
    void runRequests().finally(() => {
      runningRef.current = false;
      setRunning(false);
    });
  };

  const toggleApproach = (approachId: ApproachId) => {
    setSelected((current) =>
      current.includes(approachId)
        ? current.filter((selectedId) => selectedId !== approachId)
        : [...current, approachId],
    );
    setSelectionError(null);
    setCompleted([]);
    setShowProgress(false);
  };

  return (
    <PageShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>RAGNEX · Investigation · Step 2 of 4</SectionLabel>
          <h1 className="text-3xl font-semibold md:text-5xl">Run one question three ways</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Compare traditional retrieval, graph-based retrieval, and autonomous graph investigation
            in one workspace.
          </p>
        </div>
        <SampleNotice>RAG corpus · Graph provider status per result</SampleNotice>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="text-foreground">Overview</span>
        <ArrowRight className="size-3" />
        <strong className="text-primary">Investigation</strong>
        <ArrowRight className="size-3" />
        <span>Compare</span>
        <ArrowRight className="size-3" />
        <span>Metrics</span>
        <ArrowRight className="size-3" />
        <span>Evidence</span>
      </div>
      <section className="mb-5" aria-label="Select approaches to run">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Select approaches to run</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {APPROACH_OVERVIEW.map((approach) => {
            const isSelected = selected.includes(approach.id);
            return (
              <button
                key={approach.id}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                disabled={running}
                onClick={() => toggleApproach(approach.id)}
                className={`panel result-${approach.id} w-full p-4 text-left transition-colors disabled:cursor-not-allowed ${isSelected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-background opacity-65 hover:opacity-100"}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="result-icon grid size-9 shrink-0 place-items-center border">
                      <ApproachIcon id={approach.id} />
                    </span>
                    <span className="text-base font-semibold text-foreground">
                      {approach.title}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
                    {isSelected ? (
                      <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    {isSelected ? "Selected" : "Not selected"}
                  </span>
                </span>
                <span className="mt-3 block text-sm leading-5 text-muted-foreground">
                  {approach.description}
                </span>
              </button>
            );
          })}
        </div>
        {selectionError && (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {selectionError}
          </p>
        )}
      </section>
      <QuestionInput
        question={question}
        onQuestionChange={setQuestion}
        onSubmit={run}
        loading={running}
      />
      <section className="mt-3" aria-label="Suggested questions">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Try a question
        </h2>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={running}
              onClick={() => setQuestion(suggestion)}
              className="rounded-full border border-[color:var(--rag-blue-border)] bg-[color:var(--rag-blue-tint)] px-3 py-1.5 text-left text-xs font-medium text-[color:var(--rag-blue-text)] transition-colors hover:bg-[color:var(--rag-blue-hover)] disabled:pointer-events-none disabled:opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">
        Select one or more approaches to run against the same question.
      </p>
      {showProgress && completed.length > 0 && (
        <RunningProgress
          selected={completed}
          running={running}
          ragLoading={ragLoading}
          ragResult={ragResult}
          graphLoading={graphLoading}
          graphResult={graphResult}
          agenticLoading={agenticLoading}
          agenticResult={agenticResult}
          agenticProgress={agenticProgress}
        />
      )}
      {completed.length > 0 && (
        <section id="results" className="scroll-mt-24 pt-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel>Results · Step 3 of 4</SectionLabel>
              <h2 className="text-2xl font-semibold text-foreground">Investigation results</h2>
              <p className="mt-2 text-sm text-muted-foreground">Question: “{question}”</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/compare" search={{ question }}>
                Compare Results <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="space-y-7">
            {completed.map((id) =>
              id === "rag" ? (
                <RagResultWorkspace key={id} loading={ragLoading} result={ragResult} />
              ) : id === "graph" ? (
                <GraphRagResultWorkspace key={id} loading={graphLoading} result={graphResult} />
              ) : id === "agentic" ? (
                <AgenticResultWorkspace key={id} loading={agenticLoading} result={agenticResult} />
              ) : null,
            )}
          </div>
        </section>
      )}
    </PageShell>
  );
}

const SUGGESTED_QUESTIONS = [
  "Which Olympic events were held at Eton Dorney during the 2012 Summer Olympics?",
  "Who won the gold medal in the women's 57 kg judo event at the 2016 Summer Olympics?",
  "Where was the men's single sculls event held at the 2012 Summer Olympics?",
  "Which Olympic Games is the men's single sculls event connected to?",
  "Which athletes or nations won medals in the women's quadruple sculls event at the 2012 Summer Olympics?",
] as const;

const APPROACH_OVERVIEW = [
  { id: "rag", title: "RAG", description: "Retrieves relevant documents." },
  { id: "graph", title: "GraphRAG", description: "Retrieves and connects graph evidence." },
  {
    id: "agentic",
    title: "Agentic GraphRAG",
    description: "Autonomously investigates using tools and graph evidence.",
  },
] as const satisfies { id: ApproachId; title: string; description: string }[];

type ProgressStatus =
  "pending" | "in_progress" | "completed" | "evidence_found" | "not_required" | "failed";

type ProgressStep = { title: string; status: ProgressStatus };

function getToolStatus(
  tools: AgenticProgressToolCall[],
  activeAction: AgenticProgressSnapshot["activeAction"],
  relevantTools: AgenticProgressToolCall["tool"][],
  finished: boolean,
): ProgressStatus {
  if (activeAction && relevantTools.includes(activeAction as AgenticProgressToolCall["tool"])) {
    return "in_progress";
  }
  const calls = tools.filter((call) => relevantTools.includes(call.tool));
  if (calls.length === 0) return finished ? "not_required" : "pending";
  if (calls.some((call) => call.success && call.evidenceReturned > 0)) return "evidence_found";
  if (calls.some((call) => call.success)) return "completed";
  return "failed";
}

function getProgressSteps(
  selected: ApproachId[],
  progress: AgenticProgressSnapshot | null,
  result: AgenticResult | null,
  running: boolean,
  ragLoading: boolean,
  ragResult: RagResult | null,
  graphLoading: boolean,
  graphResult: GraphRagResult | null,
): ProgressStep[] {
  const finished = !running;
  const accepted = selected.includes("agentic") ? (progress?.questionAccepted ?? false) : true;
  const questionStatus: ProgressStatus = accepted
    ? "completed"
    : finished
      ? "failed"
      : "in_progress";

  if (!selected.includes("agentic")) {
    const steps: ProgressStep[] = [{ title: "Question", status: questionStatus }];
    if (selected.includes("rag")) {
      steps.push({
        title: "RAG request",
        status: ragLoading
          ? "in_progress"
          : ragResult?.status === "success"
            ? "evidence_found"
            : ragResult
              ? "failed"
              : "pending",
      });
    }
    if (selected.includes("graph")) {
      steps.push({
        title: "GraphRAG request",
        status: graphLoading
          ? "in_progress"
          : graphResult?.status === "success"
            ? "evidence_found"
            : graphResult
              ? "failed"
              : "pending",
      });
    }
    return steps;
  }

  const calls = result?.toolCalls ?? progress?.toolCalls ?? [];
  const activeAction = progress?.activeAction ?? null;
  const requestFinished = result !== null || progress?.finished === true;
  const evaluationIndex = calls.findIndex((call) => call.tool === "evaluate_evidence");
  const callsAfterEvaluation =
    evaluationIndex < 0
      ? []
      : calls.slice(evaluationIndex + 1).filter((call) => call.tool !== "evaluate_evidence");
  const additionalActive =
    evaluationIndex >= 0 &&
    activeAction !== null &&
    activeAction !== "generate_answer" &&
    activeAction !== "evaluate_evidence";
  let additionalStatus: ProgressStatus = "pending";
  if (additionalActive) additionalStatus = "in_progress";
  else if (callsAfterEvaluation.length > 0) {
    additionalStatus = callsAfterEvaluation.some((call) => call.success)
      ? callsAfterEvaluation.some((call) => call.evidenceReturned > 0)
        ? "evidence_found"
        : "completed"
      : "failed";
  } else if (requestFinished && (evaluationIndex >= 0 || activeAction === "generate_answer")) {
    additionalStatus = "not_required";
  }

  let answerStatus: ProgressStatus = "pending";
  if (activeAction === "generate_answer") answerStatus = "in_progress";
  else if (result?.status === "success") answerStatus = "completed";
  else if (progress?.finalAnswerState === "failed") answerStatus = "failed";
  else if (requestFinished && progress?.finalAnswerState !== "in_progress") {
    answerStatus = "not_required";
  }

  return [
    { title: "Question", status: questionStatus },
    {
      title: "Entity Identification",
      status: getToolStatus(calls, activeAction, ["extract_entities"], requestFinished),
    },
    {
      title: "Graph Traversal",
      status: getToolStatus(
        calls,
        activeAction,
        ["search_graph", "traverse_graph"],
        requestFinished,
      ),
    },
    {
      title: "Document Retrieval",
      status: getToolStatus(calls, activeAction, ["search_documents"], requestFinished),
    },
    {
      title: "Evidence Evaluation",
      status: getToolStatus(calls, activeAction, ["evaluate_evidence"], requestFinished),
    },
    { title: "Additional Investigation", status: additionalStatus },
    { title: "Final Answer", status: answerStatus },
  ];
}

function statusLabel(status: ProgressStatus): string {
  return {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    evidence_found: "Evidence Found",
    not_required: "Not Required",
    failed: "Failed",
  }[status];
}

function RunningProgress({
  selected,
  running,
  ragLoading,
  ragResult,
  graphLoading,
  graphResult,
  agenticLoading,
  agenticResult,
  agenticProgress,
}: {
  selected: ApproachId[];
  running: boolean;
  ragLoading: boolean;
  ragResult: RagResult | null;
  graphLoading: boolean;
  graphResult: GraphRagResult | null;
  agenticLoading: boolean;
  agenticResult: AgenticResult | null;
  agenticProgress: AgenticProgressSnapshot | null;
}) {
  const steps = getProgressSteps(
    selected,
    agenticProgress,
    agenticResult,
    running,
    ragLoading,
    ragResult,
    graphLoading,
    graphResult,
  );
  const activeStep = steps.findIndex((step) => step.status === "in_progress");
  const done =
    !running &&
    selected.every((id) =>
      id === "rag"
        ? ragResult !== null
        : id === "graph"
          ? graphResult !== null
          : agenticResult !== null,
    );

  return (
    <section
      className="panel mt-6 overflow-hidden"
      aria-live="polite"
      aria-label="Investigation progress"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary px-5 py-4">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">
            {done ? "Investigation complete" : "Investigation running"}
          </span>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {done
              ? "Results received from selected approaches"
              : activeStep >= 0
                ? `${steps[activeStep]?.title} · Step ${activeStep + 1} of ${steps.length}`
                : "Waiting for backend operation status"}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground" aria-live="polite">
          {done ? (
            <CheckCircle2 className="size-4 text-cyan" />
          ) : (
            <LoaderCircle className="size-4 animate-spin text-primary" />
          )}
          {done ? "Investigation complete" : "Live backend state"}
        </div>
      </header>
      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ title, status }, index) => {
          const isActive = status === "in_progress";
          return (
            <div
              key={title}
              className={`flex min-h-20 items-center gap-3 rounded-md border p-3 transition-colors ${isActive ? "border-primary bg-primary/15 shadow-glow" : status === "completed" || status === "evidence_found" ? "border-cyan/70 bg-cyan/10" : status === "failed" ? "border-destructive/60 bg-destructive/5" : "border-border bg-surface/60"}`}
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded border ${isActive ? "border-primary bg-primary text-primary-foreground" : status === "completed" || status === "evidence_found" ? "border-cyan bg-cyan text-primary-foreground" : status === "failed" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}
              >
                {status === "in_progress" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : status === "failed" ? (
                  <AlertTriangle className="size-4" />
                ) : status === "completed" || status === "evidence_found" ? (
                  <Check className="size-4" />
                ) : status === "not_required" ? (
                  <MinusCircle className="size-4" />
                ) : (
                  <Circle className="size-3" />
                )}
              </span>
              <span className="min-w-0">
                <strong className="block text-xs text-foreground">{title}</strong>
                <small
                  className={`mt-1 block text-[10px] font-semibold uppercase ${isActive ? "text-primary" : status === "completed" || status === "evidence_found" ? "text-cyan" : status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {statusLabel(status)}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RagResultWorkspace({ loading, result }: { loading: boolean; result: RagResult | null }) {
  return (
    <article className="panel result-rag overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary p-5 md:px-7">
        <div className="flex items-center gap-3">
          <span className="result-icon grid size-10 place-items-center border">
            <ApproachIcon id="rag" />
          </span>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan">
              Live · Groq RAG
            </span>
            <h2 className="text-xl font-semibold text-foreground">RAG</h2>
          </div>
        </div>
        <div className="result-state flex items-center gap-2 text-xs text-foreground">
          {loading && (
            <>
              <LoaderCircle className="size-4 animate-spin text-primary" /> Running…
            </>
          )}
          {!loading && result?.status === "success" && (
            <>
              <CheckCircle2 className="size-4" /> Result ready
            </>
          )}
          {!loading && result?.status === "error" && (
            <>
              <AlertTriangle className="size-4 text-destructive" /> Execution failed
            </>
          )}
        </div>
      </header>
      <div className="p-5 md:p-7">
        {loading && (
          <p className="text-sm text-muted-foreground">
            Retrieving context and generating a grounded answer with Groq…
          </p>
        )}
        {!loading && result?.status === "error" && (
          <div className="border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <strong className="block text-destructive">
              {result.sources?.length ? "Answer generation unavailable" : "RAG execution failed"}
            </strong>
            <p className="mt-1 text-muted-foreground">{result.message}</p>
            {result.sources && result.sources.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">Retrieved local evidence</strong>
                <EvidenceList items={result.sources} question={result.question} />
              </div>
            )}
          </div>
        )}
        {!loading && result?.status === "success" && (
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <div className="space-y-5">
              <Section title="Answer" icon={<CheckCircle2 />}>
                <p className="text-base leading-7 text-foreground md:text-lg">{result.answer}</p>
              </Section>
              <Section title="Retrieved Documents / Sources" icon={<Search />}>
                <EvidenceList items={result.sources} question={result.question} />
              </Section>
            </div>
            <aside className="space-y-5">
              <Section title="Metrics" icon={<ShieldCheck />}>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Retrieval Latency" value={formatMs(result.latency.retrievalMs)} />
                  <Metric
                    label="Generation Latency"
                    value={formatMs(result.latency.generationMs)}
                  />
                  <Metric label="Total Latency" value={formatMs(result.latency.totalMs)} />
                  <Metric
                    label="Total Tokens"
                    value={
                      result.tokens.totalTokens != null
                        ? result.tokens.totalTokens.toLocaleString()
                        : "Unknown"
                    }
                  />
                  <Metric
                    label="Chunks Retrieved"
                    value={`${result.retrieval.chunksRetrieved} / ${result.retrieval.documentsSearched}`}
                  />
                  <Metric
                    label="Confidence"
                    value={
                      result.confidence != null
                        ? `${Math.round(result.confidence * 100)}%`
                        : "Unknown"
                    }
                  />
                </div>
              </Section>
              <Section title="Retrieval" icon={<FileText />}>
                <p className="text-sm leading-6 text-muted-foreground">
                  Strategy: <strong className="text-foreground">{result.retrieval.strategy}</strong>{" "}
                  — retrieved from the local document corpus. Model:{" "}
                  <strong className="text-foreground">{result.model}</strong>.
                </p>
              </Section>
            </aside>
          </div>
        )}
      </div>
    </article>
  );
}

function GraphRagResultWorkspace({
  loading,
  result,
}: {
  loading: boolean;
  result: GraphRagResult | null;
}) {
  return (
    <article className="panel result-graph overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary p-5 md:px-7">
        <div className="flex items-center gap-3">
          <span className="result-icon grid size-10 place-items-center border">
            <ApproachIcon id="graph" />
          </span>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan">
              {loading
                ? "TigerGraph RAGNEX · GraphRAG"
                : result?.status === "success"
                  ? result.retrieval.strategy.includes("local-corpus-event-graph")
                    ? "Local corpus graph fallback · GraphRAG"
                    : "Live TigerGraph RAGNEX · GraphRAG"
                  : result?.status === "error"
                    ? `Not completed · ${result.code}`
                    : "TigerGraph RAGNEX · GraphRAG"}
            </span>
            <h2 className="text-xl font-semibold text-foreground">GraphRAG</h2>
          </div>
        </div>
        <div className="result-state flex items-center gap-2 text-xs text-foreground">
          {loading && (
            <>
              <LoaderCircle className="size-4 animate-spin text-primary" /> Running…
            </>
          )}
          {!loading && result?.status === "success" && (
            <>
              <CheckCircle2 className="size-4" /> Result ready
            </>
          )}
          {!loading && result?.status === "error" && (
            <>
              <AlertTriangle className="size-4 text-destructive" /> Execution failed
            </>
          )}
        </div>
      </header>
      <div className="p-5 md:p-7">
        {loading && (
          <p className="text-sm text-muted-foreground">
            Identifying entities, traversing the graph, and generating a grounded answer with Groq…
          </p>
        )}
        {!loading && result?.status === "error" && (
          <div className="border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <strong className="block text-destructive">GraphRAG execution failed</strong>
            <p className="mt-1 text-muted-foreground">{result.message}</p>
            {result.relationships && result.relationships.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">
                  Retrieved graph relationships
                </strong>
                <RelationshipList items={result.relationships} question={result.question} />
              </div>
            )}
            {result.evidence && result.evidence.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">Retrieved graph evidence</strong>
                <EvidenceList items={result.evidence} question={result.question} />
              </div>
            )}
          </div>
        )}
        {!loading && result?.status === "success" && (
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <div className="space-y-5">
              <Section title="Answer" icon={<CheckCircle2 />}>
                <p className="text-base leading-7 text-foreground md:text-lg">{result.answer}</p>
              </Section>
              <Section title="Entities / Relationships / Graph Path" icon={<GitBranch />}>
                <div className="mb-4 flex flex-wrap gap-2">
                  {result.entities.map((entity) => (
                    <span
                      key={entity.name}
                      className={`border px-3 py-1.5 text-xs ${entity.resolved ? "border-cyan/60 bg-cyan/10 text-foreground" : "border-border bg-secondary text-muted-foreground"}`}
                    >
                      {entity.name}
                      {entity.type ? ` (${entity.type})` : ""}
                    </span>
                  ))}
                </div>
                <div className="space-y-2">
                  {result.relationships.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No relationships retrieved for this question.
                    </p>
                  )}
                  <RelationshipList items={result.relationships} question={result.question} />
                </div>
              </Section>
              <Section title="Graph Evidence" icon={<FileText />}>
                <EvidenceList items={result.evidence} question={result.question} />
              </Section>
            </div>
            <aside className="space-y-5">
              <Section title="Metrics" icon={<ShieldCheck />}>
                <div className="grid grid-cols-2 gap-2">
                  <Metric
                    label="Entity Extraction"
                    value={formatMs(result.latency.entityExtractionMs)}
                  />
                  <Metric
                    label="Graph Query Latency"
                    value={formatMs(result.latency.graphQueryMs)}
                  />
                  <Metric
                    label="Generation Latency"
                    value={formatMs(result.latency.generationMs)}
                  />
                  <Metric label="Total Latency" value={formatMs(result.latency.totalMs)} />
                  <Metric
                    label="Total Tokens"
                    value={
                      result.tokens.totalTokens != null
                        ? result.tokens.totalTokens.toLocaleString()
                        : "Unknown"
                    }
                  />
                  <Metric
                    label="Confidence"
                    value={
                      result.confidence != null
                        ? `${Math.round(result.confidence * 100)}%`
                        : "Unknown"
                    }
                  />
                  <Metric label="Nodes Retrieved" value={String(result.retrieval.nodesRetrieved)} />
                  <Metric
                    label="Relationships Retrieved"
                    value={String(result.retrieval.relationshipsRetrieved)}
                  />
                  <Metric
                    label="Traversal Depth"
                    value={`${result.retrieval.traversalDepth} hop${result.retrieval.traversalDepth === 1 ? "" : "s"}`}
                  />
                  <Metric
                    label="Entities Resolved"
                    value={`${result.retrieval.entitiesResolved} / ${result.retrieval.entitiesQueried}`}
                  />
                </div>
              </Section>
              <Section title="Retrieval" icon={<Network />}>
                <p className="text-sm leading-6 text-muted-foreground">
                  Strategy: <strong className="text-foreground">{result.retrieval.strategy}</strong>{" "}
                  {result.retrieval.strategy.includes("local-corpus-event-graph")
                    ? "— local corpus graph fallback; TigerGraph was not used."
                    : "— live TigerGraph REST++ graph traversal."}{" "}
                  Model: <strong className="text-foreground">{result.model}</strong>.
                </p>
              </Section>
            </aside>
          </div>
        )}
      </div>
    </article>
  );
}

const STOPPING_REASON_LABEL: Record<string, string> = {
  sufficient_evidence: "Sufficient evidence",
  high_confidence: "High confidence",
  question_answered: "Question answered",
  no_useful_next_action: "No useful next action",
  max_iterations_reached: "Maximum iterations reached",
  retrieval_failure: "Retrieval failure",
  insufficient_evidence: "Insufficient evidence",
  tool_failure: "Tool failure",
};

function AgenticResultWorkspace({
  loading,
  result,
}: {
  loading: boolean;
  result: AgenticResult | null;
}) {
  return (
    <article className="panel result-agentic overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary p-5 md:px-7">
        <div className="flex items-center gap-3">
          <span className="result-icon grid size-10 place-items-center border">
            <ApproachIcon id="agentic" />
          </span>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-[color:var(--result-accent)]">
              {result?.status === "success"
                ? result.graphFallbackMode
                  ? "Agentic GraphRAG · Local graph fallback"
                  : result.retrieval.graphStrategy.startsWith("tigergraph-")
                    ? "Agentic GraphRAG · Live TigerGraph"
                    : "Agentic GraphRAG · Graph not queried"
                : result?.status === "error"
                  ? "Agentic GraphRAG · Backend execution"
                  : "Agentic GraphRAG"}
            </span>
            <h2 className="text-xl font-semibold text-foreground">Agentic GraphRAG</h2>
          </div>
        </div>
        <div className="result-state flex items-center gap-2 text-xs text-foreground">
          {loading && (
            <>
              <LoaderCircle className="size-4 animate-spin text-primary" /> Investigating…
            </>
          )}
          {!loading && result?.status === "success" && (
            <>
              <CheckCircle2 className="size-4 text-cyan" /> Result ready
            </>
          )}
          {!loading && result?.status === "error" && (
            <>
              <AlertTriangle className="size-4 text-destructive" /> Execution failed
            </>
          )}
        </div>
      </header>
      <div className="p-5 md:p-7">
        {loading && (
          <p className="text-sm text-muted-foreground">
            The agent is deciding what to investigate next, calling tools, and evaluating evidence…
          </p>
        )}
        {!loading && result?.status === "error" && (
          <div className="border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <strong className="block text-destructive">
              {result.evidence?.length
                ? "Answer generation unavailable"
                : "Agentic GraphRAG execution failed"}
            </strong>
            <p className="mt-1 text-muted-foreground">{result.message}</p>
            {result.trace.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">
                  Investigation trace · {result.iterations} iteration
                  {result.iterations === 1 ? "" : "s"}
                </strong>
                {result.trace.map((event) => (
                  <article
                    key={event.iteration}
                    className="border border-border bg-background/70 p-3"
                  >
                    <strong className="block text-xs text-foreground">
                      Iteration {event.iteration + 1} · {event.action}
                    </strong>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {event.toolCall?.outputSummary ?? event.reason}
                    </p>
                  </article>
                ))}
              </div>
            )}
            {result.evidence && result.evidence.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">
                  Evidence gathered · {result.evidence.length} items
                </strong>
                <EvidenceList items={result.evidence} question={result.question} />
              </div>
            )}
            {result.relationships && result.relationships.length > 0 && (
              <div className="mt-4 space-y-2">
                <strong className="block text-xs text-foreground">
                  Graph relationships · {result.relationships.length}
                </strong>
                <RelationshipList items={result.relationships} question={result.question} />
              </div>
            )}
            {result.retrieval && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <strong className="block text-xs text-foreground">
                  Execution metrics and provenance
                </strong>
                <p className="text-xs leading-5 text-muted-foreground">
                  Document strategy: {result.retrieval.documentStrategy}. Graph strategy:{" "}
                  {result.retrieval.graphStrategy}
                  {result.graphFallbackMode
                    ? " (local corpus graph fallback; TigerGraph not used)"
                    : ""}
                  .
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Iterations" value={String(result.iterations)} />
                  <Metric label="Tool calls" value={String(result.toolCalls.length)} />
                  <Metric label="Evidence" value={String(result.evidence?.length ?? 0)} />
                  <Metric label="Planning latency" value={formatMs(result.latency.planningMs)} />
                  <Metric label="Tool latency" value={formatMs(result.latency.toolMs)} />
                  <Metric label="Total latency" value={formatMs(result.latency.totalMs)} />
                  <Metric
                    label="Confidence"
                    value={
                      result.confidence == null
                        ? "Unknown"
                        : `${Math.round(result.confidence * 100)}%`
                    }
                  />
                  <Metric label="Graph nodes" value={String(result.retrieval.nodesDiscovered)} />
                  <Metric
                    label="Graph relationships"
                    value={String(result.retrieval.relationshipsDiscovered)}
                  />
                  <Metric label="Documents" value={String(result.retrieval.documentsRetrieved)} />
                </div>
              </div>
            )}
          </div>
        )}
        {!loading && result?.status === "success" && (
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <div className="space-y-5">
              <Section title="Answer" icon={<CheckCircle2 />}>
                <p className="text-base leading-7 text-foreground md:text-lg">{result.answer}</p>
              </Section>
              {result.entities.length > 0 && (
                <Section title="Entities / Relationships" icon={<GitBranch />}>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {result.entities.map((entity) => (
                      <span
                        key={entity.name}
                        className={`border px-3 py-1.5 text-xs ${entity.resolved ? "border-cyan/60 bg-cyan/10 text-foreground" : "border-border bg-secondary text-muted-foreground"}`}
                      >
                        {entity.name}
                        {entity.type ? ` (${entity.type})` : ""}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <RelationshipList items={result.relationships} question={result.question} />
                  </div>
                </Section>
              )}
              <Section title="Agent Investigation Trace" icon={<Sparkles />}>
                <div className="space-y-2">
                  {result.trace.map((event) => (
                    <div key={event.iteration} className="border border-border bg-secondary p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-xs text-foreground">
                          Iteration {event.iteration + 1} · {event.action}
                        </strong>
                        {event.toolCall && (
                          <span
                            className={`text-[10px] font-semibold uppercase ${event.toolCall.success ? "text-cyan" : "text-destructive"}`}
                          >
                            {event.toolCall.success ? "Succeeded" : "Failed"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Objective: {event.objective}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Reason: {event.reason}
                      </p>
                      {event.toolCall && (
                        <p className="mt-1 text-xs leading-5 text-foreground">
                          {event.toolCall.outputSummary}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="Evidence" icon={<FileText />}>
                <EvidenceList items={result.evidence} question={result.question} />
              </Section>
            </div>
            <aside className="space-y-5">
              <Section title="Metrics" icon={<ShieldCheck />}>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Iterations" value={String(result.iterations)} />
                  <Metric label="Tool Calls" value={String(result.toolCalls.length)} />
                  <Metric label="Evidence Items" value={String(result.evidence.length)} />
                  <Metric label="Planning Latency" value={formatMs(result.latency.planningMs)} />
                  <Metric label="Tool Latency" value={formatMs(result.latency.toolMs)} />
                  <Metric
                    label="Generation Latency"
                    value={formatMs(result.latency.generationMs)}
                  />
                  <Metric label="Total Latency" value={formatMs(result.latency.totalMs)} />
                  <Metric
                    label="Total Tokens"
                    value={
                      result.tokens.totalTokens != null
                        ? result.tokens.totalTokens.toLocaleString()
                        : "Unknown"
                    }
                  />
                  <Metric
                    label="Confidence"
                    value={
                      result.confidence != null
                        ? `${Math.round(result.confidence * 100)}%`
                        : "Unknown"
                    }
                  />
                  <Metric
                    label="Nodes Discovered"
                    value={String(result.retrieval.nodesDiscovered)}
                  />
                  <Metric
                    label="Relationships Discovered"
                    value={String(result.retrieval.relationshipsDiscovered)}
                  />
                  <Metric
                    label="Documents Retrieved"
                    value={String(result.retrieval.documentsRetrieved)}
                  />
                  <Metric
                    label="Max Traversal Depth"
                    value={`${result.retrieval.maxTraversalDepth} hop${result.retrieval.maxTraversalDepth === 1 ? "" : "s"}`}
                  />
                </div>
              </Section>
              <Section title="Stopping Reason" icon={<ShieldCheck />}>
                <p className="text-sm leading-6 text-muted-foreground">
                  <strong className="text-foreground">
                    {STOPPING_REASON_LABEL[result.stoppingReason] ?? result.stoppingReason}
                  </strong>
                  {" — the agent stopped here rather than running a fixed number of steps."}
                </p>
              </Section>
              <Section title="Retrieval" icon={<Network />}>
                <p className="text-sm leading-6 text-muted-foreground">
                  Document strategy:{" "}
                  <strong className="text-foreground">{result.retrieval.documentStrategy}</strong>.
                  Graph strategy:{" "}
                  <strong className="text-foreground">{result.retrieval.graphStrategy}</strong>
                  {result.graphFallbackMode
                    ? " (local corpus graph fallback; TigerGraph not used)"
                    : ""}
                  . Model: <strong className="text-foreground">{result.model}</strong>.
                </p>
              </Section>
            </aside>
          </div>
        )}
      </div>
    </article>
  );
}

function formatMs(value: number | null): string {
  if (value == null) return "Unknown";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
}

const INITIAL_EVIDENCE_COUNT = 6;

function EvidenceList({
  items,
  question,
}: {
  items: Array<{
    id: string;
    title: string;
    excerpt: string;
    kind?: string;
    score?: number | null;
    relevance?: number | null;
    url?: string | null | undefined;
  }>;
  question: string;
}) {
  const uniqueItems = prioritizeEvidence(question, items);
  const visibleItems = uniqueItems.slice(0, INITIAL_EVIDENCE_COUNT);
  const additionalItems = uniqueItems.slice(INITIAL_EVIDENCE_COUNT);

  const renderItem = (item: (typeof uniqueItems)[number]) => (
    <article key={item.id} className="border border-border bg-secondary p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs text-foreground">{item.title}</strong>
        <span className="shrink-0 text-[10px] text-cyan">
          {item.kind ?? "source"}
          {item.score != null
            ? ` · ${Math.round(item.score * 100)}% match`
            : item.relevance != null
              ? ` · ${Math.round(item.relevance * 100)}% match`
              : ""}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.excerpt}</p>
      {item.url && (
        <a
          className="mt-2 inline-block text-xs text-primary underline"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
      )}
    </article>
  );

  return (
    <div className="space-y-2">
      {visibleItems.map(renderItem)}
      {additionalItems.length > 0 && (
        <details className="border border-border bg-secondary px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            Show {additionalItems.length} more of {uniqueItems.length} evidence items
          </summary>
          <div className="mt-3 space-y-2">{additionalItems.map(renderItem)}</div>
        </details>
      )}
    </div>
  );
}

function RelationshipList({
  items,
  question,
}: {
  items: Array<{ source: string; relation: string; target: string }>;
  question: string;
}) {
  const evidence = items.map((item, index) => ({
    id: `relationship-${index}`,
    title: `${item.source} → ${item.relation} → ${item.target}`,
    excerpt: `Graph relationship: ${item.source} (${item.relation}) ${item.target}.`,
    kind: "relationship",
    relationship: item,
  }));
  const uniqueItems = prioritizeEvidence(question, evidence);
  const visibleItems = uniqueItems.slice(0, INITIAL_EVIDENCE_COUNT);
  const additionalItems = uniqueItems.slice(INITIAL_EVIDENCE_COUNT);
  const renderItem = (item: (typeof uniqueItems)[number]) => (
    <p key={item.id} className="border-l-2 border-cyan bg-secondary p-3 text-sm text-foreground">
      {item.title}
    </p>
  );

  return (
    <div className="space-y-2">
      {visibleItems.map(renderItem)}
      {additionalItems.length > 0 && (
        <details className="border border-border bg-secondary px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            Show {additionalItems.length} more of {uniqueItems.length} relationships
          </summary>
          <div className="mt-3 space-y-2">{additionalItems.map(renderItem)}</div>
        </details>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-foreground">
        <span className="text-primary [&_svg]:size-4">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-secondary p-3">
      <span className="block text-[10px] uppercase text-muted-foreground">{label}</span>
      <strong className="mt-1 block text-lg text-foreground">{value}</strong>
    </div>
  );
}
