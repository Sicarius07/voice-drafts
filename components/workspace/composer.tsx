"use client";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GOALS, type Goal } from "@/lib/angles";
import { PLACEHOLDERS } from "@/lib/text";
import { Panel } from "./surfaces";
import type { GenerateRequest } from "./use-batches";

function Chips<T extends string | number | null>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
      <span className="mr-1 w-14 text-xs text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Button key={String(o.value)} type="button" size="xs" role="radio" aria-checked={value === o.value} variant={value === o.value ? "outline" : "ghost"} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export function Composer({ topics, canCompare, busy, onGenerate }: { topics: string[]; canCompare: boolean; busy: boolean; onGenerate: (r: GenerateRequest) => void }) {
  const [goal, setGoal] = useState<Goal | "any">("any");
  const [topic, setTopic] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [n, setN] = useState(3);
  const request = (mode: GenerateRequest["mode"]): GenerateRequest => ({ goal, topic, notes, n, mode });

  return (
    <Panel className="space-y-3">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={`What do you want to post about? Numbers, names and links go here; I never invent them (otherwise you'll see ${PLACEHOLDERS[0]}).`}
        className="bg-background"
      />
      <Chips label="Goal" value={goal} onChange={setGoal} options={[{ value: "any" as const, label: "Any" }, ...GOALS.map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) }))]} />
      {topics.length > 0 && <Chips label="Topic" value={topic} onChange={setTopic} options={[{ value: null, label: "Any" }, ...topics.map((t) => ({ value: t, label: t }))]} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips label="Drafts" value={n} onChange={setN} options={[1, 2, 3, 4, 5].map((x) => ({ value: x, label: String(x) }))} />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" className="w-full" disabled={busy || !canCompare} onClick={() => onGenerate(request("ab"))}>
                  Compare with/without learning
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-60">
              {canCompare ? "Two drafts, same angle: one uses what I've learned, one doesn't. You pick blind." : "Edit a draft to teach me something first."}
            </TooltipContent>
          </Tooltip>
          <Button disabled={busy} onClick={() => onGenerate(request("normal"))}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generate {n} draft{n === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
