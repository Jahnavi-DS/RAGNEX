import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  GitBranch,
  Network,
} from "lucide-react";
import { ApproachIcon, PageShell, SectionLabel } from "@/components/lab";
import { Button } from "@/components/ui/button";
import { runGraphRagFn } from "@/functions/run-graphrag";
import { runRagFn } from "@/functions/run-rag";
import { runAgenticGraphRagFn } from "@/functions/run-agentic-graphrag";
import type { AgenticResult } from "@/server/agentic-types";
import type { GraphRagResult } from "@/server/graphrag-types";
import type { RagResult } from "@/server/rag-types";
import type { ApproachId } from "@/lib/demo-data";

export const Route = createFileRoute("/compare")({
  validateSearch: z.object({ question: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Compare RAG Approaches | RAGNEX" },
      {
        name: "description",
        content: "Compare real RAG, GraphRAG, and Agentic GraphRAG executions for one question.",
      },
      { property: "og:title", content: "RAGNEX Approach Comparison" },
      {
        property: "og:description",
        content: "Compare backend results for a single research question.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ComparePage,
});

type ComparisonResults = {
  rag: RagResult;
  graph: GraphRagResult;
  agentic: AgenticResult;
};

const APPROACHES: Array<{ id: ApproachId; name: string; description: string }> = [
  { id: "rag", name: "RAG", description: "Local document corpus retrieval" },
  { id: "graph", name: "GraphRAG", description: "TigerGraph schema traversal" },
  { id: "agentic", name: "Agentic GraphRAG", description: "Tool-directed investigation" },
];

function ComparePage() {
  const { question: routeQuestion } = Route.useSearch();
  const [question, setQuestion] = useState(routeQuestion ?? "");
  const [results, setResults] = useState<ComparisonResults | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const runComparison = useCallback(async (rawQuestion: string) => {
    const acceptedQuestion = rawQuestion.trim();
    if (!acceptedQuestion || runningRef.current) return;
    runningRef.current = true;
    setQuestion(acceptedQuestion);
    setResults(null);
    setRunning(true);

    const [rag, graph, agentic] = await Promise.all([
      runRagFn({ data: { question: acceptedQuestion } }).catch((error: unknown): RagResult => ({
        status: "error",
        question: acceptedQuestion,
        code: "unknown",
        message: error instanceof Error ? error.message : "RAG request failed.",
        latency: { retrievalMs: null, generationMs: null, totalMs: null },
      })),
      runGraphRagFn({ data: { question: acceptedQuestion } }).catch(
        (error: unknown): GraphRagResult => ({
          status: "error",
          question: acceptedQuestion,
          code: "unknown",
          message: error instanceof Error ? error.message : "GraphRAG request failed.",
          latency: {
            entityExtractionMs: null,
            graphQueryMs: null,
            generationMs: null,
            totalMs: null,
          },
        }),
      ),
      runAgenticGraphRagFn({ data: { question: acceptedQuestion } }).catch(
        (error: unknown): AgenticResult => ({
          status: "error",
          question: acceptedQuestion,
          code: "unknown",
          message: error instanceof Error ? error.message : "Agentic GraphRAG request failed.",
          trace: [],
          toolCalls: [],
          iterations: 0,
          latency: { planningMs: 0, toolMs: 0, generationMs: null, totalMs: 0 },
        }),
      ),
    ]);

    setResults({ rag, graph, agentic });
    runningRef.current = false;
    setRunning(false);
  }, []);

  useEffect(() => {
    if (routeQuestion?.trim()) void runComparison(routeQuestion);
  }, [routeQuestion, runComparison]);

  return (
    <PageShell>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>RAGNEX · Compare · Same question</SectionLabel>
          <h1 className="text-3xl font-semibold md:text-5xl">One question. Three executions.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Each column reports the result and provenance returned by its own backend pipeline.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/investigation">
            Investigation <ArrowRight />
          </Link>
        </Button>
      </div>

      <form
        className="question-box flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runComparison(question);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Comparison question
          </span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={running}
            rows={2}
            placeholder="Ask one question for all three approaches..."
            className="w-full resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70"
          />
        </label>
        <Button type="submit" disabled={running || !question.trim()} className="h-11 shrink-0 px-5">
          {running ? "Running…" : "Run Comparison"}
        </Button>
      </form>

      {running && (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          Running RAG, GraphRAG, and Agentic GraphRAG concurrently…
        </p>
      )}

      {results && (
        <>
          <p className="mt-6 text-sm text-muted-foreground">Question: “{question}”</p>
          <section
            className="mt-4 grid items-start gap-4 xl:grid-cols-3"
            aria-label="Live comparison results"
          >
            {APPROACHES.map((approach) => (
              <ComparisonCard key={approach.id} approach={approach} result={results[approach.id]} />
            ))}
          </section>
        </>
      )}
    </PageShell>
  );
}

function ComparisonCard({
  approach,
  result,
}: {
  approach: (typeof APPROACHES)[number];
  result: RagResult | GraphRagResult | AgenticResult;
}) {
  const answer = result.status === "success" ? result.answer : null;
  const failureMessage = result.status === "error" ? result.message : null;
  const evidence =
    approach.id === "rag"
      ? result.status === "success"
        ? result.evidence
        : ((result as RagResult).sources ?? [])
      : approach.id === "graph"
        ? result.status === "success"
          ? result.evidence
          : ((result as GraphRagResult).evidence ?? [])
        : ((result as AgenticResult).evidence ?? []);
  const provenance = getProvenance(approach.id, result);
  const metrics = getMetrics(approach.id, result);
  const relationships = getRelationships(approach.id, result);
  const trace = approach.id === "agentic" ? ((result as AgenticResult).trace ?? []) : [];

  return (
    <article className="panel min-w-0 overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border bg-secondary p-4">
        <span className="grid size-9 shrink-0 place-items-center border border-primary/60 bg-primary/10 text-primary">
          <ApproachIcon id={approach.id} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-foreground">{approach.name}</h2>
          <p className="text-xs text-muted-foreground">{approach.description}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold ${result.status === "success" ? "text-cyan" : "text-destructive"}`}
        >
          {result.status === "success" ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <AlertTriangle className="size-3" />
          )}
          {result.status === "success" ? "Success" : "Failed"}
        </span>
      </header>

      <div className="space-y-5 p-4">
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Answer
          </h3>
          {answer ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{answer}</p>
          ) : (
            <p className="text-sm leading-6 text-destructive">{failureMessage}</p>
          )}
        </section>

        <section className="border-t border-border pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Network className="size-3" /> Provenance
          </h3>
          <p className="break-words text-xs leading-5 text-muted-foreground">{provenance}</p>
        </section>

        <section className="border-t border-border pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <FileText className="size-3" /> Retrieved evidence · {evidence.length}
          </h3>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {evidence.map((item) => (
              <article key={item.id} className="border border-border bg-secondary p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="min-w-0 text-xs text-foreground">{item.title}</strong>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {"kind" in item ? item.kind : `${Math.round(item.relevance * 100)}%`}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {item.excerpt}
                </p>
              </article>
            ))}
            {evidence.length === 0 && (
              <p className="text-xs text-muted-foreground">No evidence was returned.</p>
            )}
          </div>
        </section>

        {relationships.length > 0 && (
          <section className="border-t border-border pt-4">
            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <GitBranch className="size-3" /> Graph relationships · {relationships.length}
            </h3>
            <div className="space-y-1.5">
              {relationships.map((relationship, index) => (
                <p
                  key={`${relationship.source}-${relationship.relation}-${relationship.target}-${index}`}
                  className="break-words border-l-2 border-cyan bg-secondary p-2 text-xs text-foreground"
                >
                  {relationship.source} → {relationship.relation} → {relationship.target}
                </p>
              ))}
            </div>
          </section>
        )}

        {trace.length > 0 && (
          <section className="border-t border-border pt-4">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Actual agent trace · {trace.length}
            </h3>
            <div className="space-y-2">
              {trace.map((event) => (
                <article key={event.iteration} className="border border-border bg-secondary p-3">
                  <strong className="text-xs text-foreground">{event.action}</strong>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {event.toolCall?.outputSummary ?? event.reason}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-border pt-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Measured execution
          </h3>
          <dl className="grid grid-cols-2 gap-2">
            {metrics.map(([label, value]) => (
              <div key={label} className="min-w-0 border border-border bg-secondary p-2">
                <dt className="text-[10px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words text-xs font-semibold text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </article>
  );
}

function getProvenance(id: ApproachId, result: RagResult | GraphRagResult | AgenticResult): string {
  if (id === "rag") {
    const rag = result as RagResult;
    return rag.status === "success"
      ? `Document retrieval: ${rag.retrieval.strategy}. Model: ${rag.model}.`
      : `RAG failed (${rag.code}). ${rag.message}`;
  }
  if (id === "graph") {
    const graph = result as GraphRagResult;
    if (graph.status === "success") {
      return `Graph strategy: ${graph.retrieval.strategy}. Model: ${graph.model}.`;
    }
    return `GraphRAG failed (${graph.code}). ${graph.message}${graph.retrieval ? ` Strategy: ${graph.retrieval.strategy}.` : ""}`;
  }
  const agentic = result as AgenticResult;
  if (agentic.status === "success") {
    return `Graph strategy: ${agentic.retrieval.graphStrategy}; document strategy: ${agentic.retrieval.documentStrategy}. Model: ${agentic.model}.`;
  }
  return `Agentic GraphRAG failed (${agentic.code}). ${agentic.message}${agentic.retrieval ? ` Graph strategy: ${agentic.retrieval.graphStrategy}; document strategy: ${agentic.retrieval.documentStrategy}.${agentic.graphFallbackMode ? " Local corpus fallback was used; TigerGraph was not used." : ""}` : ""}`;
}

function getRelationships(
  id: ApproachId,
  result: RagResult | GraphRagResult | AgenticResult,
): Array<{ source: string; relation: string; target: string }> {
  if (id === "graph") return (result as GraphRagResult).relationships ?? [];
  if (id === "agentic") {
    const agentic = result as AgenticResult;
    return agentic.relationships ?? [];
  }
  return [];
}

function getMetrics(
  id: ApproachId,
  result: RagResult | GraphRagResult | AgenticResult,
): Array<[string, string]> {
  if (id === "rag") {
    const rag = result as RagResult;
    return [
      [
        "Retrieved",
        String(rag.status === "success" ? rag.evidence.length : (rag.sources?.length ?? 0)),
      ],
      ["Retrieval ms", formatMs(rag.latency.retrievalMs)],
      ["Generation ms", formatMs(rag.latency.generationMs)],
      ["Total ms", formatMs(rag.latency.totalMs)],
      [
        "Tokens",
        rag.status === "success" && rag.tokens.totalTokens !== null
          ? String(rag.tokens.totalTokens)
          : "Unavailable",
      ],
      [
        "Confidence",
        rag.status === "success" && rag.confidence !== null
          ? `${Math.round(rag.confidence * 100)}%`
          : "Unavailable",
      ],
    ];
  }
  if (id === "graph") {
    const graph = result as GraphRagResult;
    return [
      [
        "Evidence",
        String(graph.status === "success" ? graph.evidence.length : (graph.evidence?.length ?? 0)),
      ],
      ["Graph query ms", formatMs(graph.latency.graphQueryMs)],
      ["Total ms", formatMs(graph.latency.totalMs)],
      ["Nodes", graph.retrieval ? String(graph.retrieval.nodesRetrieved) : "Unavailable"],
      [
        "Relationships",
        graph.retrieval ? String(graph.retrieval.relationshipsRetrieved) : "Unavailable",
      ],
      [
        "Tokens",
        graph.status === "success" && graph.tokens.totalTokens !== null
          ? String(graph.tokens.totalTokens)
          : "Unavailable",
      ],
      [
        "Confidence",
        graph.confidence !== null && graph.confidence !== undefined
          ? `${Math.round(graph.confidence * 100)}%`
          : "Unavailable",
      ],
    ];
  }
  const agentic = result as AgenticResult;
  return [
    ["Iterations", String(agentic.iterations)],
    ["Actual tool calls", String(agentic.toolCalls.length)],
    [
      "Evidence",
      String(
        agentic.status === "success" ? agentic.evidence.length : (agentic.evidence?.length ?? 0),
      ),
    ],
    ["Planning ms", formatMs(agentic.latency.planningMs)],
    ["Tool ms", formatMs(agentic.latency.toolMs)],
    ["Total ms", formatMs(agentic.latency.totalMs)],
    ["Nodes", agentic.retrieval ? String(agentic.retrieval.nodesDiscovered) : "Unavailable"],
    [
      "Relationships",
      agentic.retrieval ? String(agentic.retrieval.relationshipsDiscovered) : "Unavailable",
    ],
    [
      "Confidence",
      agentic.confidence == null ? "Unavailable" : `${Math.round(agentic.confidence * 100)}%`,
    ],
  ];
}

function formatMs(value: number | null): string {
  if (value === null) return "Unavailable";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}
