// SERVER-ONLY MODULE.
// Reads GROQ_API_KEY from the server process environment. This file must
// never be imported from client-rendered code.

export const GROQ_MODEL = process.env["GROQ_MODEL"]?.trim() || "openai/gpt-oss-120b";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export class GroqConfigError extends Error {
  constructor(message = "Groq API key is not configured.") {
    super(message);
    this.name = "GroqConfigError";
  }
}

export class GroqRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqRequestError";
  }
}

export type GroqUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type GroqGenerationResult = {
  text: string;
  latencyMs: number;
  usage: GroqUsage;
  model: string;
};

type GroqResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function getApiKey(): string {
  const apiKey = process.env["GROQ_API_KEY"]?.trim();
  if (!apiKey) throw new GroqConfigError();
  return apiKey;
}

/** Sends a grounded-generation request to Groq and preserves the shared result contract. */
export async function generateGroundedAnswer(prompt: string): Promise<GroqGenerationResult> {
  const start = performance.now();
  let response: Response;

  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    throw new GroqRequestError(
      error instanceof Error ? `Groq request failed: ${error.message}` : "Groq request failed.",
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new GroqRequestError(
        `Groq rate limit reached (HTTP 429). ${retryAfter ? `Retry after ${retryAfter} seconds` : "Wait briefly and retry"}; your local corpus evidence is available below.`,
      );
    }
    throw new GroqRequestError(`Groq API request failed (HTTP ${response.status}).`);
  }

  let body: GroqResponse;
  try {
    body = (await response.json()) as GroqResponse;
  } catch {
    throw new GroqRequestError("Groq returned an invalid response.");
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GroqRequestError("Groq returned an empty response.");

  return {
    text,
    latencyMs: performance.now() - start,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
      totalTokens: body.usage?.total_tokens ?? null,
    },
    model: GROQ_MODEL,
  };
}
