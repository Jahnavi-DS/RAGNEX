import type { AgenticProgressSnapshot, AgenticProgressUpdate } from "@/server/agentic-types";

const progressById = new Map<string, AgenticProgressSnapshot>();
const MAX_PROGRESS_RECORDS = 100;

export function initializeAgenticProgress(progressId: string): void {
  if (progressById.size >= MAX_PROGRESS_RECORDS) {
    const oldestId = progressById.keys().next().value;
    if (oldestId) progressById.delete(oldestId);
  }

  progressById.set(progressId, {
    questionAccepted: false,
    activeAction: null,
    toolCalls: [],
    finalAnswerState: "pending",
    finished: false,
  });
}

export function updateAgenticProgress(progressId: string, update: AgenticProgressUpdate): void {
  if (!progressById.has(progressId)) return;
  progressById.set(progressId, { ...update, finished: false });
}

export function finishAgenticProgress(progressId: string): void {
  const current = progressById.get(progressId);
  if (current) progressById.set(progressId, { ...current, finished: true });
}

export function getAgenticProgress(progressId: string): AgenticProgressSnapshot | null {
  return progressById.get(progressId) ?? null;
}
