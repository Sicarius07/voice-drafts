import "server-only";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseUsage } from "openai/resources/responses/responses";
import type { z } from "zod";
import { generation, type LlmCall } from "./tracing";

/** One model for everything; effort is the only per-stage dial. Every draft records both. */
export const MODEL = "gpt-6.1-sol";
export const EFFORT = { generate: "medium", judge: "medium", profile: "medium", humanize: "medium", rules: "low" } as const;
export type Stage = keyof typeof EFFORT;

// gpt-6.1-sol, USD per 1M tokens (standard tier, 30-minute cache writes at 1.25x input)
const PRICE = { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 };

export type Usage = { input: number; cached: number; output: number; reasoning: number; costUsd: number };

function usageOf(u: ResponseUsage | undefined): Usage {
  const input = u?.input_tokens ?? 0;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const written = (u?.input_tokens_details as { cache_write_tokens?: number } | undefined)?.cache_write_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const costUsd = ((input - cached - written) * PRICE.input + written * PRICE.cacheWrite + cached * PRICE.cachedInput + output * PRICE.output) / 1e6;
  return { input, cached, output, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0, costUsd };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cached: a.cached + b.cached,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
  costUsd: a.costUsd + b.costUsd,
});

export class LlmError extends Error {}

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI({ timeout: 120_000 })); // fail a hung call in 2 min instead of the SDK default 10

export type Call = { instructions: string; input: string; userId: string; cacheKey?: string };

const base = (stage: Stage, { instructions, input, userId, cacheKey }: Call) => ({
  model: MODEL,
  reasoning: { effort: EFFORT[stage] },
  instructions,
  input,
  store: false,
  max_output_tokens: 20_000, // reasoning tokens count toward this; billed only for what's used
  safety_identifier: createHash("sha256").update(userId).digest("hex").slice(0, 32),
  prompt_cache_key: cacheKey,
});

/** What Langfuse records for a call (sent only when tracing is on). */
const traceOf = (stage: Stage, { instructions, input, userId, cacheKey }: Call, metadata?: Record<string, unknown>): LlmCall => ({
  name: stage,
  model: MODEL,
  effort: EFFORT[stage],
  instructions,
  input,
  userId,
  metadata: { ...metadata, cacheKey },
});

const assertComplete = (r: { status?: string | null; incomplete_details?: { reason?: string } | null }) => {
  if (r.status === "incomplete") throw new LlmError(`Model stopped early (${r.incomplete_details?.reason ?? "unknown"}).`);
};

/** A connection dropped mid-response ("terminated", socket reset). The SDK only retries before the response starts. */
const DROPPED = /terminated|ECONNRESET|socket hang up|other side closed/i;
const dropped = (err: unknown) => err instanceof Error && DROPPED.test(`${err.message} ${(err.cause as Error | undefined)?.message ?? ""}`);

/** One retry for dropped connections; API errors (4xx, refusals, incomplete) are not retried. */
async function retryDropped<T>(run: (attempt: number) => Promise<T>): Promise<T> {
  try {
    return await run(0);
  } catch (err) {
    if (!dropped(err)) throw err;
    console.warn("[llm] connection dropped, retrying once:", (err as Error).cause ?? (err as Error).message);
    return run(1);
  }
}

/** Structured output validated against a zod schema (strict JSON schema on the API side). */
export function structured<S extends z.ZodType>(stage: Stage, schema: S, name: string, call: Call): Promise<{ data: z.infer<S>; usage: Usage }> {
  return generation(
    traceOf(stage, call, { schema: name }),
    async () => {
      const r = await retryDropped(() => openai().responses.parse({ ...base(stage, call), text: { format: zodTextFormat(schema, name) } }));
      assertComplete(r);
      if (!r.output_parsed) throw new LlmError("The model declined or returned nothing.");
      return { data: r.output_parsed as z.infer<S>, usage: usageOf(r.usage) };
    },
    (r) => r.data,
  );
}

/** Plain streamed text; `onDelta` receives tokens as they arrive (not on a retry: the final text replaces them). */
export function streamText(stage: Stage, call: Call, onDelta: (d: string) => void): Promise<{ text: string; usage: Usage }> {
  return generation(
    traceOf(stage, call),
    async () => {
      const r = await retryDropped(async (attempt) => {
        const stream = openai().responses.stream(base(stage, call));
        for await (const ev of stream) if (ev.type === "response.output_text.delta" && attempt === 0) onDelta(ev.delta);
        return stream.finalResponse();
      });
      assertComplete(r);
      return { text: r.output_text, usage: usageOf(r.usage) };
    },
    (r) => r.text,
  );
}
