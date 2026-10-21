"use client";

import { InfoIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hintsFor, type PlaceholderHint } from "@/lib/generate/placeholders";
import { labelOf } from "@/lib/judge/catalog";
import type { Tell } from "@/lib/judge/tells";
import { PLACEHOLDER_RE } from "@/lib/text";
import { cn } from "@/lib/utils";

/** `slot` = which placeholder this is, counting from the start of the text. */
type Piece = { text: string; tell?: Tell; slot?: number };

/** Splits text into plain runs, highlighted tells (non-overlapping, first wins) and placeholders. */
function pieces(text: string, tells: Tell[]): Piece[] {
  const marks = [
    ...tells.filter((t) => t.status !== "suppressed").map((t) => ({ start: t.start, end: t.end, tell: t, slot: undefined })),
    ...[...text.matchAll(PLACEHOLDER_RE)].map((m, slot) => ({ start: m.index!, end: m.index! + m[0].length, tell: undefined, slot })),
  ].sort((a, b) => a.start - b.start);
  const out: Piece[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({ text: text.slice(m.start, m.end), tell: m.tell, slot: m.slot });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A placeholder chip: shows the generator's hint and, when editable, fills the placeholder in place. */
function Placeholder({ label, hint, onFill }: { label: string; hint: string | null; onFill?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-primary/40 bg-primary/5 px-1 font-mono text-[13px] hover:bg-primary/10">
          {label}
          <InfoIcon aria-hidden className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-sm">
        <p className="text-muted-foreground">{hint ?? "Fill this in before posting."}</p>
        {onFill && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!value.trim()) return;
              onFill(value.trim());
              setValue(""); // after a fill, React may reuse this chip for the next placeholder
              setOpen(false);
            }}
          >
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={label.slice(1, -1)} aria-label={`Fill ${label}`} autoFocus className="h-8" />
            <Button type="submit" size="sm" disabled={!value.trim()}>
              Fill
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

type Props = { text: string; tells: Tell[]; hints?: PlaceholderHint[]; onAllow?: (category: string) => void; onFill?: (slot: number, value: string) => void };

export function TellText({ text, tells, hints = [], onAllow, onFill }: Props) {
  const hintOf = hintsFor(text, hints);
  return (
    <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
      {pieces(text, tells).map((p, i) =>
        p.slot !== undefined ? (
          <Placeholder key={i} label={p.text} hint={hintOf[p.slot]} onFill={onFill && ((value) => onFill(p.slot!, value))} />
        ) : p.tell ? (
          <Popover key={i}>
            <PopoverTrigger asChild>
              <mark
                className={cn(
                  "cursor-pointer rounded-sm px-0.5 text-inherit underline decoration-2 underline-offset-4",
                  p.tell.status === "noted"
                    ? "bg-transparent decoration-muted-foreground/40 decoration-dotted"
                    : p.tell.severity === "blocker"
                      ? "bg-blocker/15 decoration-blocker"
                      : "bg-warning/20 decoration-warning",
                )}
              >
                {p.text}
              </mark>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2 text-sm">
              <p className="font-medium">
                {labelOf(p.tell.category)} <span className="font-normal text-muted-foreground">· {p.tell.status === "noted" ? "you do this too" : p.tell.severity}</span>
              </p>
              <p className="text-muted-foreground">{p.tell.explanation}</p>
              {onAllow && p.tell.status === "flagged" && (
                <Button size="sm" variant="outline" onClick={() => onAllow(p.tell!.category)}>
                  This is fine for me
                </Button>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
