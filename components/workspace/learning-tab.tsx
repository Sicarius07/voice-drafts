"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addRule, changeRule, editRule, restoreRuleset } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ruleText, RULE_KIND_IDS, type RuleKind, type RuleParams } from "@/lib/learning/rules";
import type { ClientRule } from "@/lib/types";
import type { Workspace } from "@/server/services/workspace";
import { act } from "./act";
import { QualityChart } from "./quality-chart";
import { Panel, Sheet } from "./surfaces";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const PARAM: Partial<Record<RuleKind, { key: keyof RuleParams; placeholder: string; numeric?: boolean }>> = {
  avoid_phrase: { key: "phrase", placeholder: "phrase to avoid" },
  max_chars: { key: "n", placeholder: "max characters", numeric: true },
  style_note: { key: "note", placeholder: "e.g. drier, fewer adjectives" },
};
const paramsFrom = (kind: RuleKind, raw: string): RuleParams => {
  const p = PARAM[kind];
  return p ? { [p.key]: p.numeric ? Number(raw) : raw.trim() } : {};
};

function RuleRow({ rule, readOnly, onDone }: { rule: ClientRule; readOnly: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const param = PARAM[rule.kind];
  const run = (p: Parameters<typeof act>[0]) => act(p).then((r) => r.ok && onDone());
  return (
    <li className="space-y-2 rounded-xl bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {draft === null ? (
          <p className="flex-1 font-medium">{rule.text}</p>
        ) : (
          <Input className="h-8 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        )}
        <Badge variant={rule.status === "active" ? "default" : "secondary"}>{rule.status === "candidate" ? "tentative" : rule.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {rule.source === "manual" ? "added by you" : `${rule.evidenceCount} edit${rule.evidenceCount === 1 ? "" : "s"}`}
          {rule.archivedReason && ` · ${rule.archivedReason}`}
        </span>
      </div>
      {rule.evidence.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {rule.evidence.slice(-3).map((e, i) => (
            <li key={i}>
              {e.removed && <del className="decoration-blocker">{e.removed}</del>} {e.added && <ins className="no-underline text-foreground">→ {e.added}</ins>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-1">
          {draft !== null ? (
            <>
              <Button size="xs" onClick={() => run(editRule(rule.id, paramsFrom(rule.kind, draft))).then(() => setDraft(null))}>
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {rule.status === "candidate" && (
                <Button size="xs" onClick={() => run(changeRule(rule.id, "confirm"))}>
                  Confirm
                </Button>
              )}
              {rule.status === "archived" ? (
                <Button size="xs" variant="outline" onClick={() => run(changeRule(rule.id, "restore"))}>
                  Restore
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => run(changeRule(rule.id, "archive"))}>
                  Archive
                </Button>
              )}
              {param && (
                <Button size="xs" variant="ghost" onClick={() => setDraft(String(rule.params[param.key] ?? ""))}>
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function AddRule({ voiceId, onDone }: { voiceId: string; onDone: () => void }) {
  const [kind, setKind] = useState<RuleKind>("avoid_phrase");
  const [value, setValue] = useState("");
  const param = PARAM[kind];
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if ((await act(addRule(voiceId, kind, paramsFrom(kind, value)))).ok) {
          setValue("");
          onDone();
        }
      }}
    >
      <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} aria-label="Rule type">
        {RULE_KIND_IDS.map((k) => (
          <option key={k} value={k}>
            {k === "avoid_phrase" ? "Avoid a phrase" : k === "max_chars" ? "Max length" : k === "style_note" ? "Style note" : ruleText(k, {})}
          </option>
        ))}
      </select>
      {param && <Input className="h-8 w-56 bg-background" value={value} onChange={(e) => setValue(e.target.value)} placeholder={param.placeholder} inputMode={param.numeric ? "numeric" : undefined} />}
      <Button size="sm" variant="outline" type="submit">
        Add rule
      </Button>
    </form>
  );
}

export function LearningTab({ data }: { data: Workspace }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const readOnly = data.voice.readOnly;
  const groups = [
    { title: "Rules", hint: "Followed on every draft.", rules: data.rules.filter((r) => r.status === "active") },
    { title: "Tentative", hint: "Seen once. Applied lightly until a second edit or your Confirm.", rules: data.rules.filter((r) => r.status === "candidate") },
    { title: "Archived", hint: "Undone, contradicted by your edits, or archived by you.", rules: data.rules.filter((r) => r.status === "archived") },
  ];
  const { ab } = data;
  const angles = [...data.angles].sort((a, b) => b.mean - a.mean);

  return (
    <Sheet className="grid gap-3 p-3 sm:gap-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3 sm:space-y-4">
        {data.rules.length === 0 ? (
          <Panel title="Nothing learned yet">
            <p className="text-sm text-muted-foreground">Edit any draft and save it. Your edit becomes a tentative rule right away, and your next drafts use it.</p>
          </Panel>
        ) : (
          groups.map(
            (g) =>
              g.rules.length > 0 && (
                <Panel key={g.title} title={`${g.title} (${g.rules.length})`} hint={g.hint}>
                  <ul className="space-y-2">
                    {g.rules.map((r) => (
                      <RuleRow key={r.id} rule={r} readOnly={readOnly} onDone={refresh} />
                    ))}
                  </ul>
                </Panel>
              ),
          )
        )}
        {!readOnly && (
          <Panel title="Add a rule yourself">
            <AddRule voiceId={data.voice.id} onDone={refresh} />
          </Panel>
        )}
        <Panel title="Quality over time">
          <QualityChart series={data.series} />
        </Panel>
      </div>

      <aside className="min-w-0 space-y-3 sm:space-y-4">
        <Panel title="Blind A/B: with vs without learning" hint="Same angle and examples; the only difference is your learned rules.">
          {ab.decided === 0 ? (
            <p className="text-sm text-muted-foreground">No comparisons yet. Use “Compare with/without learning” on the Drafts tab once you have a rule.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-3xl font-semibold">{pct(ab.rate!)}</p>
              <p className="text-sm text-muted-foreground">
                learned version preferred in {ab.learned} of {ab.decided} decided comparisons
                {ab.ci && ` (95% CI ${pct(ab.ci[0])}–${pct(ab.ci[1])})`}. Ties {ab.tie}, neither {ab.neither}.
              </p>
              {ab.decided < 5 && <p className="text-xs text-muted-foreground">Too few comparisons to conclude anything yet.</p>}
            </div>
          )}
        </Panel>

        <Panel title="Angles you prefer" hint="Posterior mean of each hook formula from your feedback (starts at 50%).">
          <ul className="space-y-2">
            {angles.map((a) => (
              <li key={a.formula} className="space-y-1" title={`${a.n} signal(s)`}>
                <div className="flex justify-between text-sm">
                  <span>{a.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {pct(a.mean)} · n={a.n}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-meter-track">
                  <div className="h-full rounded-full bg-meter" style={{ width: pct(a.mean) }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Ruleset history" hint="Every change is a version. Restoring creates a new one.">
          {data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {data.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2">
                  <span className="w-8 text-muted-foreground tabular-nums">v{v.version}</span>
                  <span className="min-w-0 flex-1 truncate" title={v.reason}>
                    {v.reason}
                  </span>
                  {v.current ? (
                    <Badge variant="outline">current</Badge>
                  ) : (
                    !readOnly && (
                      <Button size="xs" variant="ghost" onClick={() => act(restoreRuleset(v.id)).then((r) => r.ok && refresh())}>
                        Restore
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        {data.voice.isShowcase && (
          <p className="px-1 text-xs text-muted-foreground">
            This is a simulated run: a scripted user with hidden preferences gave the feedback. <Link href="/voices" className="underline">Back to your voices</Link>
          </p>
        )}
      </aside>
    </Sheet>
  );
}
