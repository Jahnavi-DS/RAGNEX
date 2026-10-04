export type RankableEvidence = {
  id: string;
  title: string;
  excerpt: string;
  kind?: string;
  score?: number | null | undefined;
  relevance?: number | null | undefined;
  url?: string | null | undefined;
};

export const PROMPT_EVIDENCE_LIMIT = 16;
export const PROMPT_EXCERPT_LIMIT = 1200;

const STOP_TERMS = new Set([
  "which",
  "what",
  "where",
  "when",
  "who",
  "was",
  "were",
  "are",
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "about",
  "into",
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function evidenceScore(item: RankableEvidence, terms: string[]): number {
  const title = normalize(item.title);
  const excerpt = normalize(item.excerpt);
  let score = (item.score ?? item.relevance ?? 0) * 2;

  for (const term of terms) {
    if (title.includes(term)) score += 3;
    else if (excerpt.includes(term)) score += 1;
  }

  if (item.kind === "relationship" && item.title.includes("AT_VENUE")) {
    if (terms.includes("held") || terms.includes("venue")) score += 5;
  }
  if (item.kind === "relationship" && item.title.includes("HELD_AT")) {
    if (terms.includes("olympic") || terms.includes("games") || terms.includes("event")) {
      score += 3;
    }
  }

  return score;
}

export function prioritizeEvidence<T extends RankableEvidence>(
  question: string,
  items: T[],
  limit = Number.MAX_SAFE_INTEGER,
): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = [
      item.kind ?? "source",
      normalize(item.title),
      normalize(item.excerpt),
      item.url ?? "",
    ].join("\n");
    if (!unique.has(key)) unique.set(key, item);
  }

  const terms = [
    ...new Set(
      normalize(question)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ].filter((term) => term.length > 2 && !STOP_TERMS.has(term));
  const candidates = [...unique.values()];
  const relatedLabels = new Map<string, number>();

  for (const item of candidates) {
    if (item.kind !== "relationship") continue;
    const score = evidenceScore(item, terms);
    if (score <= 0) continue;
    const [source, , target] = item.title.split(" → ");
    if (source) {
      const key = normalize(source);
      relatedLabels.set(key, Math.max(score, relatedLabels.get(key) ?? 0));
    }
    if (target) {
      const key = normalize(target);
      relatedLabels.set(key, Math.max(score, relatedLabels.get(key) ?? 0));
    }
  }

  return candidates
    .map((item, index) => {
      const label = normalize(item.title.replace(/\s+\([^)]*\)$/, ""));
      const relatedScore =
        item.kind === "relationship" ? 0 : (relatedLabels.get(label) ?? 0) * 0.25;
      return { item, index, score: evidenceScore(item, terms) + relatedScore };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}
