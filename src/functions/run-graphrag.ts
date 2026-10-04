import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { runGraphRag } from "@/server/approaches/graphrag";
import type { GraphRagResult } from "@/server/graphrag-types";

// This file lives outside src/server/** on purpose — see the identical note
// in src/functions/run-rag.ts. TigerGraph/Savanna and Groq credentials
// stay under src/server/** and are only ever reached through this handler.

const runGraphRagInput = z.object({
  question: z.string(),
});

export const runGraphRagFn = createServerFn({ method: "POST" })
  .validator(runGraphRagInput)
  .handler(async ({ data }): Promise<GraphRagResult> => {
    return runGraphRag(data.question);
  });
