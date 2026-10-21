"use client";

import { CopyIcon, InfoIcon, Loader2Icon, StarIcon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { changeRule, fillPlaceholder, saveEdit, sendFeedback } from "@/app/actions";
import { HandleAvatar } from "@/components/handle-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { THUMBS_DOWN_REASONS } from "@/lib/learning/signals";
import { PLACEHOLDER_RE, weightedLength } from "@/lib/text";
import type { ClientDraft, LearnedReceipt } from "@/lib/types";
import { act } from "./act";
import { TellsMeter, VoiceMatchMeter } from "./meters";
import { TellText } from "./tell-text";
import type { Slot } from "./use-batches";

export type Author = { name: string; username: string; avatarUrl: string | null };
type CardProps = {
  slot: Slot;
  author: Author;
  readOnly: boolean;
  label?: string;
  onPatch: (id: string, patch: Partial<ClientDraft> | null) => void;
  onAllow: (category: string) => void;
};

/** Toasts what the system just learned from an edit, with Undo on new rules. */
function showReceipt(r: LearnedReceipt, refresh: () => void) {
  r.created.forEach((rule) =>
    toast(`New tentative rule: ${rule.text}`, {
      description: "Applied to your next drafts. Confirm or edit it under Learning.",
      action: { label: "Undo", onClick: () => act(changeRule(rule.id, "undo")).then(refresh) },
    }),
  );
  r.strengthened.forEach((rule) => toast(rule.status === "active" ? `Rule confirmed by a second edit: ${rule.text}` : `Seen again: ${rule.text}`));
  r.contradicted.forEach((rule) => toast(`You put back what "${rule.text}" removed, so ${rule.status === "archived" ? "I dropped that rule" : "I weakened it"}.`));
}

function CharCount({ text }: { text: string }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{weightedLength(text)} chars</span>;
}

function CardShell({ author, angle, label, children }: { author: Author; angle: string; label?: string; children: React.ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[1.25rem] bg-platter p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <HandleAvatar name={author.name} src={author.avatarUrl} />
        <div className="min-w-32 flex-1 leading-tight">
          <p className="truncate font-medium">{author.name}</p>
          <p className="text-sm text-muted-foreground">@{author.username}</p>
        </div>
        {label ? <Badge>{label}</Badge> : <Badge variant="outline">{angle}</Badge>}
      </header>
      {children}
    </article>
  );
}

export function DraftCard({ slot, author, readOnly, label, onPatch, onAllow }: CardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const d = slot.draft;

  if (!d)
    return (
      <CardShell author={author} angle={slot.angle} label={label}>
        {slot.status === "error" ? (
          <p className="text-sm text-destructive">Couldn&apos;t draft this one: {slot.error}</p>
        ) : slot.text ? (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{slot.text}</p>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {slot.status !== "error" && <Loader2Icon className="size-3 animate-spin" />}
          {slot.status === "streaming" ? `Drafting a ${slot.angle.toLowerCase()}…` : slot.status === "checking" ? "Checking voice and AI tells…" : null}
        </p>
      </CardShell>
    );

  const current = d.kept ?? d.text;
  const feedback = async (type: Parameters<typeof sendFeedback>[1], patch: Partial<ClientDraft> | null, payload?: Record<string, unknown>) => {
    if ((await act(sendFeedback(d.id, type, payload))).ok) onPatch(d.id, patch);
  };

  async function save() {
    if (editing === null) return;
    setSaving(true);
    const r = await act(saveEdit(d!.id, editing));
    setSaving(false);
    if (!r.ok) return;
    onPatch(d!.id, { kept: editing.trim() });
    setEditing(null);
    showReceipt(r.data, () => router.refresh());
    router.refresh();
  }

  async function fill(slot: number, value: string) {
    const r = await act(fillPlaceholder(d!.id, slot, value));
    if (r.ok) onPatch(d!.id, { kept: r.data.text, hints: r.data.hints });
  }

  async function copy() {
    await navigator.clipboard.writeText(current);
    const left = current.match(PLACEHOLDER_RE)?.length ?? 0;
    if (left) toast.warning(`Copied, but ${left} placeholder${left === 1 ? " is" : "s are"} still to fill.`);
    else toast.success("Copied. Paste it into X yourself; nothing is posted for you.");
    await feedback("copy", { state: { ...d!.state, copied: true } });
  }

  return (
    <CardShell author={author} angle={d.angle} label={label}>
      {editing !== null ? (
        <div className="space-y-2">
          <Textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={5} autoFocus />
          <div className="flex items-center justify-between">
            <CharCount text={editing} />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2Icon className="animate-spin" />}
                {saving ? "Learning from your edit…" : "Save edit"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <TellText
            text={d.kept ?? (showBefore && d.humanizedFrom ? d.humanizedFrom : d.text)}
            tells={d.kept || (d.humanizedFrom && !showBefore) ? [] : d.tells} // a rewrite's tells were found in the original
            hints={d.hints}
            onAllow={readOnly ? undefined : onAllow}
            onFill={readOnly || (showBefore && !d.kept) ? undefined : fill}
          />
          {d.kept && <p className="text-xs text-muted-foreground">Edited by you · meters apply to the original draft</p>}
        </div>
      )}

      {/* Meters and actions sit at the bottom, so side-by-side cards line up. */}
      <div className="mt-auto space-y-3">
        {d.warnings.map((w) => (
          <p key={w.code} className="text-xs text-warning">
            {w.message} {w.items.join(", ")}
          </p>
        ))}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <VoiceMatchMeter vm={d.voiceMatch} />
          <TellsMeter tells={d.tells} rewritten={!!d.humanizedFrom} />
          <CharCount text={current} />
          {d.humanizedFrom && !d.kept && (
            <button type="button" className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => setShowBefore((s) => !s)}>
              {showBefore ? "Show rewrite" : "Show original"}
            </button>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-1 border-t pt-2">
          {!readOnly && (
            <>
              <Button size="icon-sm" variant={d.state.thumbs === "up" ? "outline" : "ghost"} aria-label="Good draft" onClick={() => feedback("thumbs_up", { state: { ...d.state, thumbs: "up" } })}>
                <ThumbsUpIcon />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon-sm" variant={d.state.thumbs === "down" ? "outline" : "ghost"} aria-label="Bad draft">
                    <ThumbsDownIcon />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-60 space-y-2">
                  <p className="text-sm font-medium">What&apos;s wrong with it?</p>
                  <div className="flex flex-wrap gap-1">
                    {THUMBS_DOWN_REASONS.map((reason) => (
                      <Button key={reason} size="xs" variant="outline" onClick={() => feedback("thumbs_down", { state: { ...d.state, thumbs: "down" } }, { reasons: [reason] })}>
                        {reason}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="ghost" onClick={() => setEditing(current)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={copy}>
                <CopyIcon /> Copy
              </Button>
              <Button size="sm" variant={d.state.picked ? "outline" : "ghost"} onClick={() => feedback("pick", { state: { ...d.state, picked: true } })} disabled={d.state.picked}>
                <StarIcon /> {d.state.picked ? "Best" : "Pick best"}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete draft" onClick={() => feedback("delete", null)}>
                <Trash2Icon />
              </Button>
            </>
          )}
          <WhyThisDraft draft={d} />
        </footer>
      </div>
    </CardShell>
  );
}

function WhyThisDraft({ draft }: { draft: ClientDraft }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground">
          <InfoIcon /> Why this draft?
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <p>
          <span className="font-medium">Angle:</span> {draft.angle}
        </p>
        <div>
          <p className="font-medium">Learned rules applied</p>
          {draft.why.rules.length ? (
            <ul className="list-disc pl-4 text-muted-foreground">
              {draft.why.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{draft.arm === "baseline" ? "None (this was the no-learning baseline)." : "None yet."}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {draft.why.model} · prompt {draft.why.promptVersion}
        </p>
      </PopoverContent>
    </Popover>
  );
}
