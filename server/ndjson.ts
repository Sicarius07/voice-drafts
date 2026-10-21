import "server-only";
import type { z } from "zod";
import { getUser } from "@/server/auth";
import { UserError } from "@/server/services/context";
import type { Send } from "@/server/services/voices";
import { XApiError } from "@/server/x/client";

const publicMessage = (err: unknown) => {
  if (err instanceof UserError || err instanceof XApiError) return err.message;
  console.error(err);
  return "Something went wrong. Please try again.";
};

/** Streams newline-delimited JSON events; errors become a final `error` event the UI can show. */
export function ndjson(run: (send: Send) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (e) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        await run(send);
      } catch (err) {
        send({ type: "error", message: publicMessage(err), kind: err instanceof XApiError ? err.kind : undefined });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/** Parses a JSON body against a schema; returns a 400 Response when it doesn't match. */
export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | Response> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? parsed.data : Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
}

/** Authenticated NDJSON route: 401 if signed out, otherwise streams `run`. */
export async function authedStream(run: (userId: string, send: Send) => Promise<void>): Promise<Response> {
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  return ndjson((send) => run(user.id, send));
}
