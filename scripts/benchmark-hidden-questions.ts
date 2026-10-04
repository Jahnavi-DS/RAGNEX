import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HiddenQuestion = {
  qid: string;
  question: string;
  qtype: string;
};

type BenchmarkRecord = {
  qid: string;
  qtype: string;
  question: string;
  rag_answer: string | null;
  graphrag_answer: string | null;
  agentic_answer: string | null;
  tokens_used: {
    rag: number | null;
    graphrag: number | null;
    agentic: number | null;
  };
  latency_ms: {
    rag: number | null;
    graphrag: number | null;
    agentic: number | null;
  };
  agentic_trace: Awaited<
    ReturnType<typeof import("../src/server/agentic/agentic-orchestrator.ts").runAgenticInvestigation>
  >["trace"];
  status: {
    rag: "success" | "error";
    graphrag: "success" | "error";
    agentic: "success" | "error";
  };
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(projectRoot, "data", "questions", "eval_hidden.jsonl");
const outputPath = path.join(
  projectRoot,
  "benchmark-results",
  "hidden-questions-results.json",
);

function readQuestions(): HiddenQuestion[] {
  const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/);
  const questions: HiddenQuestion[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Invalid JSON in hidden evaluation data at line ${index + 1}.`);
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid hidden evaluation record at line ${index + 1}.`);
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record["qid"] !== "string" ||
      typeof record["question"] !== "string" ||
      !record["question"].trim() ||
      typeof record["qtype"] !== "string"
    ) {
      throw new Error(`Hidden evaluation record at line ${index + 1} has invalid fields.`);
    }

    questions.push({
      qid: record["qid"],
      question: record["question"].trim(),
      qtype: record["qtype"],
    });
  }

  if (questions.length !== 50) {
    throw new Error(`Expected exactly 50 hidden evaluation questions; found ${questions.length}.`);
  }
  return questions;
}

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseLimit(): number | undefined {
  const rawLimit = readOption("--limit");
  if (rawLimit === undefined) return undefined;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("--limit must be a whole number from 1 to 50.");
  }
  return limit;
}

function printUsage(): void {
  console.log(
    "Usage: npm run benchmark:hidden -- --run [--limit <1-50>] [--overwrite]\n" +
      "Without --run, this script makes no backend calls.",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printUsage();
    return;
  }
  if (!args.includes("--run")) {
    printUsage();
    throw new Error("Benchmark execution requires explicit --run confirmation.");
  }
  if (args.some((arg) => !["--run", "--overwrite"].includes(arg) && !arg.startsWith("--limit"))) {
    throw new Error("Unknown benchmark option.");
  }

  const limit = parseLimit();
  const questions = readQuestions().slice(0, limit);
  if (fs.existsSync(outputPath) && !args.includes("--overwrite")) {
    throw new Error(
      `${path.relative(projectRoot, outputPath)} already exists. Pass --overwrite to replace it.`,
    );
  }

  const [{ runRag }, { runGraphRag }, { runAgenticInvestigation }] = await Promise.all([
    import("../src/server/approaches/rag.ts"),
    import("../src/server/approaches/graphrag.ts"),
    import("../src/server/agentic/agentic-orchestrator.ts"),
  ]);

  const results: BenchmarkRecord[] = [];
  for (const [index, item] of questions.entries()) {
    console.log(`Running question ${index + 1}/${questions.length} (${item.qid})`);
    const rag = await runRag(item.question);
    const graphrag = await runGraphRag(item.question);
    const agentic = await runAgenticInvestigation(item.question);

    results.push({
      qid: item.qid,
      qtype: item.qtype,
      question: item.question,
      rag_answer: rag.status === "success" ? rag.answer : null,
      graphrag_answer: graphrag.status === "success" ? graphrag.answer : null,
      agentic_answer: agentic.status === "success" ? agentic.answer : null,
      tokens_used: {
        rag: rag.status === "success" ? rag.tokens.totalTokens : null,
        graphrag: "tokens" in graphrag ? (graphrag.tokens?.totalTokens ?? null) : null,
        agentic: agentic.tokens?.totalTokens ?? null,
      },
      latency_ms: {
        rag: rag.latency.totalMs,
        graphrag: graphrag.latency.totalMs,
        agentic: agentic.latency.totalMs,
      },
      agentic_trace: agentic.trace,
      status: {
        rag: rag.status,
        graphrag: graphrag.status,
        agentic: agentic.status,
      },
    });
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`Wrote ${results.length} real results to ${path.relative(projectRoot, outputPath)}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
