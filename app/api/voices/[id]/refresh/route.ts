import { authedStream } from "@/server/ndjson";
import { refreshVoice } from "@/server/services/voices";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: RouteContext<"/api/voices/[id]/refresh">) {
  const { id } = await params;
  return authedStream(async (userId, send) => {
    await refreshVoice(userId, id, send);
    send({ type: "done", voiceId: id });
  });
}
