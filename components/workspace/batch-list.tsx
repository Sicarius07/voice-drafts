"use client";

import { useRouter } from "next/navigation";
import { chooseAb, regenerateBatch } from "@/app/actions";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import type { AbChoice } from "@/lib/types";
import { act } from "./act";
import { DraftCard, type Author } from "./draft-card";
import type { GenerateRequest, LiveBatch, useBatches } from "./use-batches";

type Ctl = ReturnType<typeof useBatches>;
type Props = { batch: LiveBatch; author: Author; readOnly: boolean; ctl: Ctl };

const ARM_LABEL = { learned: "with learning", baseline: "without learning", normal: "" } as const;

function AbPair({ batch, author, readOnly, ctl }: Props) {
  const router = useRouter();
  const ab = batch.ab;
  async function choose(choice: AbChoice) {
    const r = await act(chooseAb(batch.id, choice));
    if (!r.ok) return;
    ctl.patchBatch(batch.id, { ab: { choice, arms: r.data } });
    router.refresh();
  }
  const ready = batch.slots.every((s) => s.status === "done" || s.status === "error");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {batch.slots.map((s, i) => (
          <DraftCard
            key={s.idx}
            slot={s}
            author={author}
            readOnly={readOnly || !ab}
            label={`${"AB"[i]}${ab ? ` · ${ARM_LABEL[ab.arms[i]]}` : ""}`}
            onPatch={ctl.patchDraft}
            onAllow={ctl.allow}
          />
        ))}
      </div>
      {!ab && !readOnly && ready && (
        <div className="flex flex-wrap items-center gap-2 rounded-[1.25rem] border border-dashed border-border px-4 py-3">
          <span className="text-sm font-medium">Which would you post?</span>
          {(["a", "b", "tie", "neither"] as const).map((c) => (
            <Button key={c} size="sm" variant={c.length === 1 ? "default" : "outline"} onClick={() => choose(c)}>
              {c.length === 1 ? c.toUpperCase() : c === "tie" ? "Both equally" : "Neither"}
            </Button>
          ))}
        </div>
      )}
      {ab && (
        <p className="text-sm text-muted-foreground">
          You chose {ab.choice.length === 1 ? ab.choice.toUpperCase() : ab.choice}.{" "}
          {ab.choice.length === 1 && `That was the version ${ARM_LABEL[ab.arms["ab".indexOf(ab.choice)]]}.`}
        </p>
      )}
    </div>
  );
}

export function BatchView(props: Props) {
  const { batch, author, readOnly, ctl } = props;
  const done = batch.slots.every((s) => s.status === "done" || s.status === "error");
  const retry = async (req: GenerateRequest) => {
    if ((await act(regenerateBatch(batch.id))).ok) ctl.generate(req);
  };
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
        <span>{batch.kind === "ab" ? `Blind comparison · ${batch.slots[0]?.angle}` : `${batch.slots.length} draft${batch.slots.length === 1 ? "" : "s"}`}</span>
        <span>· goal {batch.goal}</span>
        {batch.topic && <span>· {batch.topic}</span>}
        <span>
          · <LocalTime iso={batch.createdAt} />
        </span>
        {batch.kind === "normal" && done && !readOnly && (
          <Button size="xs" variant="ghost" className="ml-auto" disabled={ctl.busy} onClick={() => retry({ goal: batch.goal, topic: batch.topic, notes: batch.notes, n: batch.slots.length, mode: "normal" })}>
            Not these, try again
          </Button>
        )}
      </header>
      {batch.kind === "ab" ? (
        <AbPair {...props} />
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {batch.slots.map((s) => (
            <DraftCard key={s.idx} slot={s} author={author} readOnly={readOnly} onPatch={ctl.patchDraft} onAllow={ctl.allow} />
          ))}
        </div>
      )}
    </section>
  );
}
