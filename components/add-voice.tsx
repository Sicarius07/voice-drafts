"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/workspace/surfaces";
import { postStream } from "@/lib/ndjson-client";
import { MIN_PASTED, splitPasted } from "@/lib/text";

const X_DOWN = new Set(["credits", "unavailable", "rate_limited"]);

export function AddVoice({ demos }: { demos: { username: string; name: string }[] }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null); // null = panel closed
  const pastedCount = paste ? splitPasted(paste).length : 0;

  async function create(h: string, pasted?: string) {
    if (!h.trim()) return setError("Enter a handle first.");
    setBusy(true);
    setSteps([]);
    setError(null);
    let voiceId: string | undefined;
    await postStream("/api/voices", { handle: h, pasted }, (e) => {
      if (e.type === "progress") setSteps((s) => [...s, e.step]);
      if (e.type === "done") voiceId = e.voiceId;
      if (e.type === "error") {
        setError(X_DOWN.has(e.kind ?? "") ? `X API unavailable (${e.message}). Paste your posts instead.` : e.message);
        if (X_DOWN.has(e.kind ?? "")) setPaste((p) => p ?? "");
      }
    });
    setBusy(false);
    if (voiceId) router.push(`/voices/${voiceId}`);
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Whose voice?</h1>
        <p className="text-sm text-muted-foreground">
          Enter your own X handle. We read your latest ~200 original posts once (no replies or reposts) and build a voice profile.
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create(handle);
        }}
      >
        <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourhandle" disabled={busy} aria-label="X handle" />
        <Button type="submit" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          Build voice
        </Button>
      </form>

      {demos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">No handle handy? Try a demo voice (public account, not affiliated):</span>
          {demos.map((d) => (
            <Button key={d.username} variant="outline" size="sm" disabled={busy} onClick={() => create(d.username)}>
              @{d.username}
            </Button>
          ))}
        </div>
      )}

      {steps.length > 0 && (
        <ol className="space-y-1 text-sm text-muted-foreground" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              {busy && i === steps.length - 1 ? <Loader2Icon className="size-3 animate-spin" /> : <span className="size-3 text-center">✓</span>}
              {s}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {paste === null ? (
        <button type="button" className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setPaste("")}>
          Or paste your posts instead
        </button>
      ) : (
        <Panel title={`Paste at least ${MIN_PASTED} of your posts, separated by blank lines`} className="space-y-2">
          <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} placeholder={"first post\n\nsecond post\n\n…"} className="bg-background" />
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {pastedCount} post{pastedCount === 1 ? "" : "s"} detected · fewer posts = lower confidence
            </span>
            <Button size="sm" disabled={busy || pastedCount < MIN_PASTED} onClick={() => create(handle || "pasted", paste)}>
              Build from pasted posts
            </Button>
          </div>
        </Panel>
      )}
    </section>
  );
}
