"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { meter, type Tell } from "@/lib/judge/tells";
import type { VoiceMatch } from "@/lib/profile/voice-match";
import { cn } from "@/lib/utils";

function Meter({ label, value, tone, help, children }: { label: string; value: string; tone: "good" | "warning" | "blocker"; help: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex min-w-0 cursor-default items-center gap-2 text-xs" tabIndex={0}>
          <span className="text-muted-foreground">{label}</span>
          {children}
          <span className={cn("font-medium tabular-nums", { good: "text-good", warning: "text-warning", blocker: "text-blocker" }[tone])}>{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{help}</TooltipContent>
    </Tooltip>
  );
}

export function VoiceMatchMeter({ vm }: { vm: VoiceMatch }) {
  const tone = vm.score >= 50 ? "good" : vm.score >= 20 ? "warning" : "blocker";
  return (
    <Meter
      label="Voice match"
      value={String(vm.score)}
      tone={tone}
      help={
        <div className="space-y-1">
          <p>More typical of you than {vm.score}% of your own posts (style stats only).</p>
          {vm.deviations.length > 0 && <p>Off because it {vm.deviations.join("; ")}.</p>}
        </div>
      }
    >
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", { good: "bg-good", warning: "bg-warning", blocker: "bg-blocker" }[tone])} style={{ width: `${vm.score}%` }} />
      </span>
    </Meter>
  );
}

const LEVEL = { clean: ["Clean", "good"], minor: ["Minor", "warning"], needs_work: ["Needs work", "blocker"] } as const;

export function TellsMeter({ tells, rewritten }: { tells: Tell[]; rewritten: boolean }) {
  const m = meter(tells);
  const [label, tone] = LEVEL[m.level];
  const noted = tells.filter((t) => t.status === "noted").length;
  if (rewritten)
    return (
      <Meter
        label="AI tells"
        value="Rewritten"
        tone="good"
        help={`The first draft had ${m.blockers} blocker(s) and ${m.warnings} warning(s), so it was rewritten in your voice to remove them (not re-checked). "Show original" highlights what was flagged.`}
      />
    );
  return (
    <Meter
      label="AI tells"
      value={m.blockers + m.warnings ? `${label} · ${m.blockers + m.warnings}` : label}
      tone={tone}
      help={`${m.blockers} blocker(s), ${m.warnings} warning(s)${noted ? `, ${noted} pattern(s) you use yourself (not counted)` : ""}. Click a highlight for details. Not a "% AI" score.`}
    />
  );
}
