import { z } from "zod";
import { authedStream, parseJson } from "@/server/ndjson";
import { createVoice } from "@/server/services/voices";

export const maxDuration = 300;

const Body = z.object({ handle: z.string().min(1).max(100), pasted: z.string().max(100_000).optional() });

/** Creates a voice from a handle (X API, cached for everyone) or from pasted posts; streams progress. */
export async function POST(req: Request) {
  const body = await parseJson(req, Body);
  if (body instanceof Response) return body;
  return authedStream(async (userId, send) => {
    const voiceId = await createVoice(userId, body, send);
    send({ type: "done", voiceId });
  });
}
