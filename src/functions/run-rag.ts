import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { runRag } from "@/server/approaches/rag";
import type { RagResult } from "@/server/rag-types";

// This file lives outside src/server/** on purpose: this project's Vite
// config denies any client-bundle import matching **/server/** (see
// vite.config.ts / @lovable.dev/vite-tanstack-config's importProtection
// rule) as a guardrail against server-only code leaking into the browser
// bundle. createServerFn's handler body still only runs on the server —
// TanStack Start strips it out of the client bundle — but the *file doing
// the importing* must sit outside `server/` for that guardrail to allow it.
// The actual Groq credentials and RAG pipeline logic stay under
// src/server/** and are only ever reached through this handler.

const runRagInput = z.object({
  question: z.string(),
});

export const runRagFn = createServerFn({ method: "POST" })
  .validator(runRagInput)
  .handler(async ({ data }): Promise<RagResult> => {
    return runRag(data.question);
  });
