import { z } from "zod";
import { GOALS } from "@/lib/angles";
import { authedStream, parseJson } from "@/server/ndjson";
import { loadVoiceCtx } from "@/server/services/context";
import { runBatch } from "@/server/services/generate";

export const maxDuration = 300;

const Body = z.object({
  goal: z.enum([...GOALS, "any"]),
  topic: z.string().max(80).nullable(),
  notes: z.string().max(2000),
  n: z.number().int().min(1).max(5),
  mode: z.enum(["normal", "ab"]),
});

/** Streams a batch of drafts (or one blind A/B pair) as NDJSON events. */
export async function POST(req: Request, { params }: RouteContext<"/api/voices/[id]/generate">) {
  const { id } = await params;
  const input = await parseJson(req, Body);
  if (input instanceof Response) return input;
  return authedStream(async (userId, send) => runBatch(await loadVoiceCtx(id, userId), userId, input, send));
}
