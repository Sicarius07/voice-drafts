import type { StreamEvent } from "@/lib/types";

/** POSTs JSON and calls `on` for every NDJSON event in the streamed response. */
export async function postStream(url: string, body: unknown, on: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    on({ type: "error", message: (await res.text()) || res.statusText });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) on(JSON.parse(line) as StreamEvent);
    }
  }
}
