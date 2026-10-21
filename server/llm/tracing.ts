import "server-only";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, setLangfuseTracerProvider, startActiveObservation } from "@langfuse/tracing";
import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { waitUntil } from "@vercel/functions";
import type { Usage } from "./client";

/**
 * Optional Langfuse tracing: on only when LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL are set
 * (the SDK reads LANGFUSE_TRACING_ENVIRONMENT itself). Off, every helper just runs its function.
 * Langfuse gets its own tracer provider, so Next.js's request spans never reach it.
 */
const ENABLED = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"].every((k) => process.env[k]);

// Kept on globalThis so dev hot reloads reuse one processor.
const g = globalThis as { langfuse?: LangfuseSpanProcessor };
function processor() {
  if (ENABLED && !g.langfuse) {
    g.langfuse = new LangfuseSpanProcessor();
    setLangfuseTracerProvider(new BasicTracerProvider({ spanProcessors: [g.langfuse] }));
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable()); // lets calls nest under a batch
  }
  return g.langfuse;
}

let flushing: Promise<unknown> = Promise.resolve();

/**
 * Sends buffered spans. On Vercel, waitUntil keeps the function alive until they're out; scripts await it before exiting.
 * Chained, because forceFlush doesn't wait for an export an earlier flush already started.
 */
export function flushTraces() {
  if (!g.langfuse) return flushing;
  flushing = Promise.all([flushing, g.langfuse.forceFlush()]).catch((err) => console.warn("[langfuse] flush failed:", err));
  waitUntil(flushing);
  return flushing;
}

const inTrace = () => {
  const span = trace.getActiveSpan();
  return !!span && isSpanContextValid(span.spanContext());
};

/** Groups the LLM calls made inside `fn` (e.g. one generation batch) into one trace. */
export async function traced<T>(name: string, attrs: { userId: string; sessionId?: string; input?: unknown }, fn: () => Promise<T>): Promise<T> {
  if (!processor()) return fn();
  try {
    return await propagateAttributes({ userId: attrs.userId, sessionId: attrs.sessionId, traceName: name }, () =>
      startActiveObservation(name, (span) => {
        span.update({ input: attrs.input });
        return fn();
      }),
    );
  } finally {
    flushTraces();
  }
}

export type LlmCall = { name: string; model: string; effort: string; instructions: string; input: string; userId: string; metadata?: Record<string, unknown> };

/** One LLM call as a Langfuse generation: prompt in; output, tokens and our computed cost out. Failed calls are marked by the SDK. */
export async function generation<T extends { usage: Usage }>(llm: LlmCall, run: () => Promise<T>, output: (r: T) => unknown): Promise<T> {
  if (!processor()) return run();
  const root = !inTrace();
  try {
    return await propagateAttributes({ userId: llm.userId }, () =>
      startActiveObservation(
        llm.name,
        async (gen) => {
          gen.update({
            model: llm.model,
            modelParameters: { reasoning_effort: llm.effort },
            input: [
              { role: "system", content: llm.instructions },
              { role: "user", content: llm.input },
            ],
            metadata: llm.metadata,
          });
          const r = await run();
          const u = r.usage;
          gen.update({
            output: output(r),
            // OpenAI counts cached tokens inside input and reasoning inside output; split them so the parts add up to total.
            usageDetails: { input: u.input - u.cached, input_cached_tokens: u.cached, output: u.output - u.reasoning, output_reasoning_tokens: u.reasoning, total: u.input + u.output },
            costDetails: { total: u.costUsd }, // Langfuse has no price for this model; send ours (cache writes included)
          });
          return r;
        },
        { asType: "generation" },
      ),
    );
  } finally {
    if (root) flushTraces(); // calls inside a batch are flushed once, when the batch ends
  }
}
