import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Crosshair, Gauge, ShieldCheck, Target, Zap, type LucideIcon } from "lucide-react";
import { ApproachIcon, BenchmarkChart, PageShell, SampleNotice, SectionLabel } from "@/components/lab";
import { Button } from "@/components/ui/button";
import { approaches, benchmark } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "RAGNEX | AI Research Intelligence" },
    { name: "description", content: "Compare RAG, GraphRAG, and Agentic GraphRAG to understand their impact on answer quality and evidence." },
    { property: "og:title", content: "RAGNEX | From Retrieval to Autonomous Investigation" },
    { property: "og:description", content: "Compare retrieval, relationships, and autonomous investigation in one AI intelligence platform." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: OverviewPage,
});

function OverviewPage() {
  return <PageShell className="overflow-hidden">
    <section className="relative flex min-h-[620px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-card/60 px-5 py-20 shadow-glow backdrop-blur-xl md:px-10 lg:min-h-[680px]">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-card via-surface to-accent/60" />
      <div className="pointer-events-none absolute right-[8%] top-24 hidden lg:block"><div className="ice-cube grid size-36 rotate-6 place-items-center text-[10px] font-bold uppercase tracking-[.16em] text-primary">Retrieve</div><div className="ice-cube -ml-28 -mt-2 grid size-28 -rotate-6 place-items-center text-[10px] font-bold uppercase tracking-[.16em] text-cyan">Reason</div><div className="ice-cube ml-20 -mt-5 grid size-32 rotate-12 place-items-center text-[10px] font-bold uppercase tracking-[.12em] text-violet">Investigate</div></div>
      <div className="max-w-4xl"><SectionLabel>Agentic GraphRAG Hackathon · V1 Demo</SectionLabel><h1 className="brand-wordmark text-5xl font-semibold leading-none text-foreground md:text-7xl lg:text-[84px]">RAGNEX</h1><p className="mt-5 max-w-4xl font-display text-2xl font-medium leading-tight text-foreground md:text-4xl">From Retrieval to <span className="text-primary">Autonomous</span> Investigation</p><p className="mt-7 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">Compare traditional retrieval, graph-based retrieval, and autonomous investigation to understand how different reasoning strategies affect answer quality and evidence.</p><div className="mt-9 flex flex-wrap gap-3"><Button asChild size="lg"><Link to="/investigation">Start Investigation <ArrowRight /></Link></Button><Button asChild size="lg" variant="outline"><Link to="/metrics">View Benchmark <Gauge /></Link></Button></div></div>
      <div className="mt-16 grid max-w-5xl gap-4 lg:grid-cols-3">{approaches.map((item) => <article key={item.id} className={cn("panel relative p-6 hover:-translate-y-1", item.id === "rag" ? "approach-rag" : item.id === "graph" ? "approach-graph" : "approach-agentic")}><div className="mb-10 flex items-start justify-between"><span className="grid size-10 place-items-center rounded-md border border-[var(--approach-accent)] bg-surface text-[var(--approach-accent)]"><ApproachIcon id={item.id} /></span><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.short}</span></div><h2 className="text-xl font-semibold text-foreground">{item.name}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p><span className="absolute inset-x-5 bottom-0 h-0.5 bg-[var(--approach-accent)]" /></article>)}</div>
    </section>
    <section className="grid gap-12 py-20 lg:grid-cols-[0.8fr_1.2fr]"><div><SectionLabel>Why compare?</SectionLabel><h2 className="text-3xl font-semibold text-foreground md:text-4xl">One question.<br />Three research behaviors.</h2><p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">Different question shapes reward different methods. Compare quality and cost together instead of treating one approach as universally superior.</p><div className="mt-8 grid grid-cols-2 gap-px border border-border bg-border">{([{label:"Accuracy",icon:Target},{label:"Completeness",icon:ShieldCheck},{label:"Token efficiency",icon:Zap},{label:"Evidence quality",icon:Crosshair}] satisfies Array<{label:string;icon:LucideIcon}>).map(({label,icon:Icon}) => <div key={label} className="flex items-center gap-3 bg-background p-4 text-sm font-medium"><Icon className="size-4 text-primary" />{label}</div>)}</div></div><div className="panel p-6 md:p-8"><div className="mb-8 flex items-end justify-between"><div><h3 className="text-lg font-semibold">Benchmark preview</h3><p className="mt-1 text-xs text-muted-foreground">Accuracy across representative question sets</p></div><SampleNotice /></div><BenchmarkChart data={benchmark} /></div></section>
  </PageShell>;
}