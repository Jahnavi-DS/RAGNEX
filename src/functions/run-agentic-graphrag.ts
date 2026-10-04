import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { runAgenticInvestigation } from "@/server/agentic/agentic-orchestrator";
import {
  finishAgenticProgress,
  getAgenticProgress,
  initializeAgenticProgress,
  updateAgenticProgress,
} from "@/server/agentic/progress";
import type { AgenticResult } from "@/server/agentic-types";

// This file lives outside src/server/** on purpose — see the identical note
// in src/functions/run-rag.ts and src/functions/run-graphrag.ts. Groq and
// TigerGraph/Savanna credentials stay under src/server/** and are only ever
// reached through this handler. Independent from runRagFn/runGraphRagFn —
// all three approaches remain separately executable.

const runAgenticGraphRagInput = z.object({
  question: z.string(),
  progressId: z.string().optional(),
});

const agenticProgressInput = z.object({
  progressId: z.string().min(1),
});

export const runAgenticGraphRagFn = createServerFn({ method: "POST" })
  .validator(runAgenticGraphRagInput)
  .handler(async ({ data }): Promise<AgenticResult> => {
    if (!data.progressId) return runAgenticInvestigation(data.question);
    initializeAgenticProgress(data.progressId);
    try {
      return await runAgenticInvestigation(data.question, (update) =>
        updateAgenticProgress(data.progressId!, update),
      );
    } finally {
      finishAgenticProgress(data.progressId);
    }
  });

export const getAgenticProgressFn = createServerFn({ method: "POST" })
  .validator(agenticProgressInput)
  .handler(({ data }) => getAgenticProgress(data.progressId));
