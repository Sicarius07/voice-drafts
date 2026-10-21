"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { allowTell } from "@/app/actions";
import type { FormulaId, Goal } from "@/lib/angles";
import { labelOf, type TellCategory } from "@/lib/judge/catalog";
import { postStream } from "@/lib/ndjson-client";
import type { ClientBatch, ClientDraft } from "@/lib/types";
import { act } from "./act";

export type Slot = {
  idx: number;
  angle: string;
  formula: FormulaId;
  text: string;
  status: "streaming" | "checking" | "done" | "error";
  draft?: ClientDraft;
  error?: string;
};
export type LiveBatch = Omit<ClientBatch, "drafts"> & { slots: Slot[] };
export type GenerateRequest = { goal: Goal | "any"; topic: string | null; notes: string; n: number; mode: "normal" | "ab" };

const fromServer = (b: ClientBatch): LiveBatch => ({
  ...b,
  slots: b.drafts.map((d) => ({ idx: d.idx, angle: d.angle, formula: d.formula, text: d.text, status: "done", draft: d })),
});

/**
 * Batches in the Drafts tab = server data + batches streamed in this session, with local patches
 * (feedback state, deletions, A/B answers, allowlisted tells) layered on top until the server catches up.
 */
export function useBatches(voiceId: string, server: ClientBatch[]) {
  const router = useRouter();
  const [live, setLive] = useState<LiveBatch[]>([]);
  const [draftPatches, setDraftPatches] = useState<Record<string, Partial<ClientDraft> | null>>({});
  const [batchPatches, setBatchPatches] = useState<Record<string, Partial<LiveBatch>>>({});
  const [suppressed, setSuppressed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const serverIds = new Set(server.map((b) => b.id));
  const patchDraftView = (d: ClientDraft): ClientDraft | null => {
    const p = draftPatches[d.id];
    if (p === null) return null;
    const merged = { ...d, ...p };
    return suppressed.length ? { ...merged, tells: merged.tells.map((t) => (suppressed.includes(t.category) ? { ...t, status: "suppressed" as const } : t)) } : merged;
  };
  const batches = [...live.filter((b) => !serverIds.has(b.id)), ...server.map(fromServer)].map((b) => ({
    ...b,
    ...batchPatches[b.id],
    slots: b.slots.flatMap((s) => {
      if (!s.draft) return [s];
      const draft = patchDraftView(s.draft);
      return draft ? [{ ...s, draft }] : [];
    }),
  }));

  const patchSlot = (batchId: string, idx: number, fn: (s: Slot) => Slot) =>
    setLive((bs) => bs.map((b) => (b.id === batchId ? { ...b, slots: b.slots.map((s) => (s.idx === idx ? fn(s) : s)) } : b)));
  const patchDraft = (id: string, patch: Partial<ClientDraft> | null) =>
    setDraftPatches((ps) => ({ ...ps, [id]: patch === null ? null : { ...ps[id], ...patch } }));
  const patchBatch = (id: string, patch: Partial<LiveBatch>) => setBatchPatches((ps) => ({ ...ps, [id]: { ...ps[id], ...patch } }));

  /** "This is fine for me": persists the allowlist entry and un-highlights that category everywhere. */
  async function allow(category: string) {
    if (!(await act(allowTell(voiceId, category))).ok) return;
    setSuppressed((s) => [...s, category]);
    toast(`Got it: I won't flag "${labelOf(category as TellCategory)}" for this voice.`);
  }

  async function generate(req: GenerateRequest) {
    setBusy(true);
    let batchId = "";
    await postStream(`/api/voices/${voiceId}/generate`, req, (e) => {
      if (e.type === "batch") {
        batchId = e.batch.id;
        setLive((bs) => [{ ...e.batch, slots: e.angles.map((a) => ({ ...a, text: "", status: "streaming" as const })) }, ...bs]);
      } else if (e.type === "delta") patchSlot(batchId, e.idx, (s) => ({ ...s, text: s.text + e.d }));
      else if (e.type === "text") patchSlot(batchId, e.idx, (s) => ({ ...s, text: e.text, status: "checking" }));
      else if (e.type === "draft") patchSlot(batchId, e.idx, (s) => ({ ...s, text: e.draft.text, status: "done", draft: e.draft }));
      else if (e.type === "draft_error") patchSlot(batchId, e.idx, (s) => ({ ...s, status: "error", error: e.message }));
      else if (e.type === "error") toast.error(e.message);
    });
    setBusy(false);
    router.refresh();
  }

  return { batches, busy, generate, patchDraft, patchBatch, allow };
}
