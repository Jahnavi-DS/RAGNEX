import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  FileSearch,
  Menu,
  Network,
  Search,
  Sparkles,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approaches, evidence, type ApproachId } from "@/lib/demo-data";

const nav = [
  ["Overview", "/"],
  ["Investigation", "/investigation"],
  ["Compare", "/compare"],
  ["Metrics", "/metrics"],
  ["Evidence", "/evidence"],
] as const;

export function Navigation() {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-5 px-4 lg:px-8">
        <Link to="/" className="group flex min-w-0 items-center gap-3" aria-label="RAGNEX home">
          <span className="grid size-9 shrink-0 place-items-center border border-primary/35 bg-primary/10 text-primary shadow-glow transition-colors group-hover:border-cyan/60 group-hover:text-cyan"><Network className="size-4" /></span>
          <span className="brand-wordmark text-sm font-bold sm:text-base">RAGNEX</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {nav.map(([label, to]) => (
            <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className="nav-link">{label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-3">
          <span className="hidden items-center gap-1.5 border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary sm:flex"><Sparkles className="size-3" /> Agentic GraphRAG</span>
          <div className="relative hidden sm:block"><button className="icon-button grid" onClick={() => setProfileOpen(!profileOpen)} aria-label="Open profile" aria-expanded={profileOpen}><CircleUserRound className="size-4" /></button>{profileOpen && <div className="absolute right-0 top-11 w-52 border border-border bg-card p-3 shadow-glow"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center bg-secondary text-foreground"><UserRound className="size-4" /></span><span><strong className="block text-xs text-foreground">Researcher</strong><small className="text-muted-foreground">Backend execution</small></span></div></div>}</div>
          <button className="icon-button lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X className="size-4" /> : <Menu className="size-4" />}</button>
        </div>
      </div>
      {open && <nav className="grid border-t border-border bg-background p-3 lg:hidden" aria-label="Mobile navigation">{nav.map(([label, to]) => <Link key={to} to={to} onClick={() => setOpen(false)} className="nav-link py-3">{label}</Link>)}</nav>}
    </header>
  );
}

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("page-enter mx-auto min-h-screen max-w-[1480px] px-4 pb-16 pt-24 lg:px-8", className)}>{children}</main>;
}

export function Footer() {
  return <footer className="border-t border-border bg-background/80"><div className="mx-auto flex max-w-[1480px] flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8"><div><strong className="brand-wordmark text-foreground">RAGNEX</strong><span className="ml-3">From Retrieval to Autonomous Investigation</span></div><span>Local document corpus · Graph provider reported per run</span></div></footer>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" />{children}</div>;
}

export function SampleNotice({ children = "Sample benchmark data for demonstration" }: { children?: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 bg-cyan" />{children}</span>;
}

export function QuestionInput({
  question,
  onQuestionChange,
  onSubmit,
  compact = false,
  disabled = false,
  loading = false,
}: {
  question: string;
  onQuestionChange: (question: string) => void;
  onSubmit: (question: string) => void;
  compact?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const submit = () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading || disabled) return;
    onSubmit(trimmedQuestion);
  };
  return (
    <div className={cn("question-box flex items-end gap-3", compact && "p-3")}>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Investigation question</span>
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          disabled={loading}
          rows={compact ? 1 : 2}
          placeholder="Ask a complex question about the dataset..."
          className="w-full resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70 md:text-lg"
        />
      </label>
      <Button
        onClick={submit}
        disabled={loading || disabled || !question.trim()}
        className="h-11 shrink-0 px-5"
      >
        {loading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
        ) : (
          <Search />
        )}
        {loading ? "Investigating..." : "Run Investigation"}
      </Button>
    </div>
  );
}

export function ApproachSelector({
  selected,
  onChange,
  disabled = false,
}: {
  selected: ApproachId[];
  onChange: (value: ApproachId[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: ApproachId) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {approaches.map((approach) => (
        <button
          key={approach.id}
          onClick={() => toggle(approach.id)}
          disabled={disabled}
          className={cn(
            "selector disabled:pointer-events-none disabled:opacity-60",
            approach.id === "rag"
              ? "approach-rag"
              : approach.id === "graph"
                ? "approach-graph"
                : "approach-agentic",
            selected.includes(approach.id) && "selector-active",
          )}
          aria-pressed={selected.includes(approach.id)}
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-current">
              <ApproachIcon id={approach.id} />
            </span>
            <span>
              <strong className="block text-sm text-foreground">{approach.name}</strong>
              <small className="mt-1 text-muted-foreground">{approach.description}</small>
            </span>
          </span>
          <span className="grid size-5 shrink-0 place-items-center rounded border border-current">
            {selected.includes(approach.id) && <Check className="size-3" />}
          </span>
        </button>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return <article className="panel p-5"><div className="mb-6 flex items-center justify-between text-muted-foreground"><span className="text-xs font-medium uppercase tracking-[0.14em]">{label}</span>{icon}</div><div className="text-3xl font-semibold text-foreground">{value}</div><p className="mt-2 text-xs text-muted-foreground">{detail}</p></article>;
}

export function BenchmarkChart({ data, metric = "accuracy", height = 210, suffix }: { data: Array<Record<string, string | number>>; metric?: string; height?: number; suffix?: string }) {
  const max = Math.max(...data.map((item) => Number(item[metric])));
  return <div className="flex items-end gap-4" style={{ height }} role="img" aria-label={`${metric} comparison chart`}>{data.map((item, index) => { const value = Number(item[metric]); const label = String(item["approach"] ?? item["label"]); const unit = suffix ?? (metric === "latency" ? "s" : "%"); return <div key={label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2"><span className="text-center text-sm font-semibold text-foreground">{value}{unit}</span><div className="relative flex-1 border-b border-border bg-surface"><div className={cn("absolute inset-x-0 bottom-0 transition-all duration-700", index === 2 ? "bg-primary shadow-glow" : index === 1 ? "bg-violet" : "bg-cyan")} style={{ height: `${(value / max) * 88}%` }} /></div><span className="text-center text-[10px] leading-4 text-muted-foreground">{label}</span></div>; })}</div>;
}

export function InvestigationTrace({ steps, active = 8 }: { steps: readonly (readonly [string, string])[]; active?: number }) {
  const [expanded, setExpanded] = useState<number | null>(active);
  return <div className="space-y-0">{steps.map(([title, detail], index) => <button key={title} onClick={() => setExpanded(expanded === index ? null : index)} className="group flex w-full gap-3 text-left"><span className="flex flex-col items-center"><span className={cn("mt-0.5 grid size-6 place-items-center border text-[10px]", index <= active ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground")}>{index <= active ? <Check className="size-3" /> : index + 1}</span>{index < steps.length - 1 && <span className="h-full w-px bg-border" />}</span><span className="pb-5"><span className="block text-sm font-medium text-foreground">{title}</span>{expanded === index && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>}</span></button>)}</div>;
}

export function EvidenceCard({ item }: { item: (typeof evidence)[number] }) {
  const [open, setOpen] = useState(false);
  return <article className="border border-border bg-surface/70"><button onClick={() => setOpen(!open)} className="flex w-full items-center gap-4 p-4 text-left"><FileSearch className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-foreground">{item.title}</strong><span className="text-xs text-muted-foreground">{item.type} · {item.relevance}% relevance</span></span><span className="hidden text-xs font-medium text-cyan sm:block">{item.confidence}% confidence</span><ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} /></button>{open && <div className="border-t border-border px-4 py-4 text-sm leading-6 text-muted-foreground">“{item.excerpt}”</div>}</article>;
}

const graphNodes = [
  { id: "a", label: "Person A", x: 55, y: 108, kind: "person" },
  { id: "x", label: "Company X", x: 190, y: 55, kind: "company" },
  { id: "y", label: "Company Y", x: 340, y: 125, kind: "company" },
  { id: "z", label: "Product Z", x: 485, y: 68, kind: "product" },
  { id: "e", label: "Launch", x: 420, y: 205, kind: "event" },
];

export function GraphVisualization({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState("y");
  const active = useMemo(() => graphNodes.find((node) => node.id === selected), [selected]);
  return <div className="graph-frame relative overflow-hidden"><svg viewBox="0 0 550 260" className={cn("w-full", compact ? "h-56" : "h-72")} role="img" aria-label="Interactive entity relationship graph"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" className="stroke-border" strokeWidth="0.5" /></pattern></defs><rect width="550" height="260" fill="url(#grid)" /><g className="stroke-cyan/70" strokeWidth="2"><line x1="55" y1="108" x2="190" y2="55" /><line x1="190" y1="55" x2="340" y2="125" /><line x1="340" y1="125" x2="485" y2="68" /><line x1="340" y1="125" x2="420" y2="205" /></g><g className="fill-foreground text-[10px] font-medium"><text x="105" y="73">founded</text><text x="247" y="82">acquired</text><text x="397" y="82">launched</text><text x="360" y="176">triggered</text></g>{graphNodes.map((node) => <g key={node.id} onClick={() => setSelected(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(node.id); }} tabIndex={0} role="button" aria-label={`Select ${node.label}`} className="cursor-pointer outline-none"><circle cx={node.x} cy={node.y} r={selected === node.id ? 18 : 14} className={cn("transition-all", selected === node.id ? "fill-primary stroke-foreground" : node.kind === "product" ? "fill-cyan/30 stroke-cyan" : "fill-surface-strong stroke-violet")} strokeWidth="2" /><text x={node.x} y={node.y + 31} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">{node.label}</text></g>)}</svg><div className="absolute bottom-3 left-3 border border-border bg-card px-3 py-2 text-xs"><span className="text-muted-foreground">Selected</span><strong className="ml-2 text-foreground">{active?.label}</strong></div></div>;
}

export function SourceViewer() {
  const [query, setQuery] = useState("");
  const shown = evidence.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()) || item.type.toLowerCase().includes(query.toLowerCase()));
  return <div><div className="mb-4 flex items-center border border-border bg-surface px-3"><Search className="size-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter sources" className="h-11 w-full bg-transparent px-3 text-sm outline-none" /></div><div className="space-y-2">{shown.map((item) => <EvidenceCard key={item.title} item={item} />)}{shown.length === 0 && <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No sources match this filter.</div>}</div></div>;
}

export function ApproachIcon({ id }: { id: ApproachId }) {
  return id === "rag" ? <Search /> : id === "graph" ? <Network /> : <BrainCircuit />;
}

export const labIcons = { Zap, Clock3, ArrowRight };