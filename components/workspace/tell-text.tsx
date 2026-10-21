"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { labelOf } from "@/lib/judge/catalog";
import type { Tell } from "@/lib/judge/tells";
import { PLACEHOLDER_RE } from "@/lib/text";
import { cn } from "@/lib/utils";

type Piece = { text: string; tell?: Tell; placeholder?: boolean };

/** Splits text into plain runs, highlighted tells (non-overlapping, first wins) and placeholders. */
function pieces(text: string, tells: Tell[]): Piece[] {
  const marks = [
    ...tells.filter((t) => t.status !== "suppressed").map((t) => ({ start: t.start, end: t.end, tell: t })),
    ...[...text.matchAll(PLACEHOLDER_RE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, tell: undefined })),
  ].sort((a, b) => a.start - b.start);
  const out: Piece[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({ text: text.slice(m.start, m.end), tell: m.tell, placeholder: !m.tell });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function TellText({ text, tells, onAllow }: { text: string; tells: Tell[]; onAllow?: (category: string) => void }) {
  return (
    <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
      {pieces(text, tells).map((p, i) =>
        p.placeholder ? (
          <span key={i} className="rounded border border-dashed border-primary/40 bg-primary/5 px-0.5 font-mono text-[13px]" title="Fill this in before posting">
            {p.text}
          </span>
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
