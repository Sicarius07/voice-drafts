"use client";

import { useState } from "react";
import { LocalTime } from "@/components/local-time";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Counted } from "@/lib/profile/qualities";
import { habitFeatures } from "@/lib/profile/stats";
import type { BinaryFeature } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/server/services/workspace";
import { Panel, Sheet } from "./surfaces";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => Math.round(x).toLocaleString("en-US");

/** The LLM cites posts by prompt index ("(t1, t29–t31)"); readers can't look those up, so they're hidden. */
const stripCites = (s: string) => s.replace(/\s*\((?:t\d+(?:\s*[–-]\s*t?\d+)?[,;\s]*)+\)/g, "");

/** "Technical and step-by-step: names the bottleneck…" → term + detail. */
function splitTone(t: string): [string, string] {
  const i = t.indexOf(":");
  if (i < 1) return [t, ""];
  const detail = t.slice(i + 1).trim();
  return [t.slice(0, i), detail.charAt(0).toUpperCase() + detail.slice(1)];
}

const STYLE_ROWS: [BinaryFeature, string][] = [
  ["lowercaseStart", "Start lowercase"],
  ["noTerminalPunct", "End without punctuation"],
  ["multiLine", "Span several lines"],
  ["digits", "Include numbers"],
  ["ellipsis", "Pause with “..” or “...”"],
  ["hasEmoji", "Use emoji"],
  ["list", "Use a list"],
  ["link", "Include a link"],
  ["questionEnd", "End on a question"],
  ["exclamation", "Use exclamation marks"],
  ["hasHashtag", "Use hashtags"],
  ["hasEmDash", "Use em dashes"],
];

const ORNAMENT_LIST =
  "h-auto max-w-full overflow-x-auto rounded-full bg-ornament p-1 shadow-ornament ring-1 ring-white/10 backdrop-blur-xl backdrop-saturate-150 [scrollbar-width:none] group-data-horizontal/tabs:h-auto";
const ORNAMENT_TRIGGER =
  "h-8 flex-none rounded-full px-2.5 text-[13px] text-ornament-foreground/70 hover:text-ornament-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ornament-foreground/60 data-active:bg-ornament-foreground/15 data-active:text-ornament-foreground sm:px-4 sm:text-sm dark:text-ornament-foreground/70 dark:hover:text-ornament-foreground dark:data-active:border-transparent dark:data-active:bg-ornament-foreground/15 dark:data-active:text-ornament-foreground";

/** How a tab's contents were derived: code, the LLM, or both. */
const Provenance = ({ children }: { children: React.ReactNode }) => <p className="max-w-[72ch] px-1 text-[13px]/relaxed text-balance text-muted-foreground">{children}</p>;

type Share = { key: string; label: React.ReactNode; share: number; tip: string };

/** Share-of-posts meters. Rows stack (label over bar) until the panel is wide enough for one line each. */
function ShareRows({ rows }: { rows: Share[] }) {
  return (
    <ul className="space-y-2.5 @md:space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 text-sm @md:grid-cols-[11rem_minmax(0,1fr)_3rem]">
          <span className="min-w-0">{r.label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="col-span-2 row-start-2 block py-1.5 @md:col-span-1 @md:row-start-auto">
                <span
                  role="meter"
                  aria-label={typeof r.label === "string" ? r.label : r.key}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(r.share * 100)}
                  aria-valuetext={r.tip}
                  className="block h-1.5 overflow-hidden rounded-full bg-meter-track"
                >
                  <span className="block h-full rounded-full bg-meter" style={{ width: pct(r.share) }} />
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.tip}</TooltipContent>
          </Tooltip>
          <span className="text-right tabular-nums">{pct(r.share)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Phrases as the person writes them, most frequent first. */
function Said({ items, before = "", after = "", label }: { items: Counted[]; before?: string; after?: string; label: string }) {
  const unique = [...new Map(items.map((p) => [p.text.trim().toLowerCase(), { text: p.text.trim(), count: p.count }])).values()];
  return (
    <ul aria-label={label} className="flex flex-wrap gap-x-7 gap-y-3">
      {unique
        .sort((a, b) => b.count - a.count)
        .map((p) => (
          <li key={p.text} className="flex items-baseline gap-1.5">
            <q className="font-quote text-lg">
              {before}
              {p.text}
              {after}
            </q>
            <span className="text-xs text-muted-foreground tabular-nums">{p.count}×</span>
          </li>
        ))}
    </ul>
  );
}

function SignaturePost({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 600 || text.split("\n").length > 12;
  const folded = long && !open;
  return (
    <li>
      <Panel className="sm:px-8 sm:py-7">
        <blockquote className={cn("font-quote text-[17px]/[1.65] whitespace-pre-wrap", folded && "max-h-72 overflow-hidden mask-b-from-65%")}>{text}</blockquote>
        {long && (
          <button type="button" className="mt-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show the full post"}
          </button>
        )}
      </Panel>
    </li>
  );
}

export function VoiceTab({ data }: { data: Workspace }) {
  const { stats: s, qualities: q, signatures } = data.profile;
  const habits = new Set<string>(habitFeatures(s));
  const posts = (k: number) => `${num(k)} of ${num(s.n)} posts`;

  const styleRows: Share[] = [
    ...STYLE_ROWS.map(([k, label]): Share => ({
      key: k,
      label: k === "hasEmoji" && s.topEmoji.length ? <>{label} <span className="ml-1 tracking-widest">{s.topEmoji.join("")}</span></> : label,
      share: s.rates[k],
      tip: posts(s.rates[k] * s.n),
    })),
    { key: "quote", label: "Quote another post", share: s.quoteRate, tip: posts(s.quoteRate * s.n) },
  ].sort((a, b) => b.share - a.share);
  const habitRows = styleRows.filter((r) => habits.has(r.key));
  const otherRows = styleRows.filter((r) => !habits.has(r.key));
  const topicRows: Share[] = [...q.topics].sort((a, b) => b.count - a.count).map((t) => ({ key: t.label, label: t.label, share: s.n ? t.count / s.n : 0, tip: posts(t.count) }));
  const hasVocabulary = q.phrases.length + q.openers.length + q.closers.length + q.neverUses.length > 0;

  return (
    <Tabs defaultValue="persona" className="gap-0">
      <Sheet>
        <div className="sticky top-14 z-10 -mt-5 flex justify-center px-2 sm:px-4">
          <TabsList aria-label="Voice profile" className={ORNAMENT_LIST}>
            <TabsTrigger value="persona" className={ORNAMENT_TRIGGER}>
              Persona
            </TabsTrigger>
            <TabsTrigger value="style" className={ORNAMENT_TRIGGER}>
              Style
            </TabsTrigger>
            <TabsTrigger value="vocabulary" className={ORNAMENT_TRIGGER}>
              Vocabulary
            </TabsTrigger>
            <TabsTrigger value="signatures" className={ORNAMENT_TRIGGER}>
              Signature posts
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="px-3 pt-6 pb-5 sm:px-6 sm:pt-7">
          {s.confidence === "low" && (
            <p className="mb-5 rounded-[1.25rem] border border-warning/50 bg-warning/10 p-4 text-sm">Low confidence: this is a first pass. More posts make the profile sharper.</p>
          )}

          <TabsContent value="persona" className="space-y-5">
            <Provenance>Written by the AI from your posts. Topics and positions stay only if at least two of your posts back them up.</Provenance>
            <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
              <Panel title="Who you are" className="lg:col-span-3">
                <p className="max-w-[60ch] text-lg/relaxed text-pretty">{stripCites(q.persona)}</p>
              </Panel>
              <Panel title="Who you write for" className="lg:col-span-2">
                <p className="text-[15px]/relaxed text-pretty">{stripCites(q.audience)}</p>
              </Panel>
              {topicRows.length > 0 && (
                <Panel title="Topics" hint="Share of your posts the AI tagged with each topic" className={cn(q.tone.length ? "lg:col-span-2" : "lg:col-span-5")}>
                  <ShareRows rows={topicRows} />
                </Panel>
              )}
              {q.tone.length > 0 && (
                <Panel title="Tone" className={cn(topicRows.length ? "lg:col-span-3" : "lg:col-span-5")}>
                  <dl className="space-y-4 text-[15px]/relaxed">
                    {q.tone.map((t) => {
                      const [term, detail] = splitTone(t);
                      return (
                        <div key={t}>
                          <dt className="font-medium">{term}</dt>
                          {detail && <dd className="text-muted-foreground">{detail}</dd>}
                        </div>
                      );
                    })}
                  </dl>
                </Panel>
              )}
              {q.positions.length > 0 && (
                <Panel title="Positions you keep coming back to" className="lg:col-span-5">
                  <ul className="list-disc gap-10 pl-5 text-[15px]/relaxed marker:text-muted-foreground @2xl:columns-2">
                    {q.positions.map((p) => (
                      <li key={p} className="mb-3 break-inside-avoid">
                        {p}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </TabsContent>

          <TabsContent value="style" className="space-y-5">
            <Provenance>Counted by code across all {num(s.n)} posts. Bars show the share of your posts. No AI involved.</Provenance>
            <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              <Panel title="Typical post" className="lg:col-start-1">
                <p className="text-xl/normal">
                  {num(s.length.p50)} characters, about {num(s.medianWords)} words.
                </p>
                <p className="mt-1 text-[15px] text-muted-foreground">
                  Most run between {num(s.length.p10)} and {num(s.length.p90)} characters.
                </p>
              </Panel>
              <Panel title="Habits the AI-tell check won’t flag" hint="You do these in 10% or more of your posts, so drafts may use them too." className="lg:col-start-1">
                {habitRows.length ? <ShareRows rows={habitRows} /> : <p className="text-sm text-muted-foreground">None of the patterns the check looks for show up in 10% of your posts.</p>}
              </Panel>
              <Panel title="Everything else" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
                <ShareRows rows={otherRows} />
              </Panel>
            </div>
          </TabsContent>

          <TabsContent value="vocabulary" className="space-y-5">
            <Provenance>
              Suggested by the AI, then counted by code: a phrase stays only if it appears at least twice, and a word you never use must appear zero times. Counts are times it appears across your {num(s.n)} posts.
            </Provenance>
            {!hasVocabulary && <Panel><p className="text-[15px] text-muted-foreground">No phrases came up often enough to count. More posts would help.</p></Panel>}
            <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {q.phrases.length > 0 && (
                <Panel title="Phrases you repeat" className="lg:col-span-2">
                  <Said items={q.phrases} label="Phrases you repeat" />
                </Panel>
              )}
              {q.openers.length > 0 && (
                <Panel title="How you start posts" className={cn(!q.closers.length && "lg:col-span-2")}>
                  <Said items={q.openers} after="…" label="How you start posts" />
                </Panel>
              )}
              {q.closers.length > 0 && (
                <Panel title="How you end posts" className={cn(!q.openers.length && "lg:col-span-2")}>
                  <Said items={q.closers} before="…" label="How you end posts" />
                </Panel>
              )}
              {q.neverUses.length > 0 && (
                <Panel title="Words you never use" hint="Drafts are told to avoid them." className="lg:col-span-2">
                  <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-muted-foreground">
                    {q.neverUses.map((w) => (
                      <li key={w} className="line-through decoration-blocker/70">
                        {w}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </TabsContent>

          <TabsContent value="signatures">
            <div className="mx-auto max-w-2xl space-y-5">
              <Provenance>Picked by the AI as most typical of you and quoted word for word. Every draft request includes them as examples.</Provenance>
              {signatures.length ? (
                <ul className="space-y-3 sm:space-y-4">
                  {signatures.map((t, i) => (
                    <SignaturePost key={i} text={t} />
                  ))}
                </ul>
              ) : (
                <Panel>
                  <p className="text-[15px] text-muted-foreground">No signature posts yet. They’re picked when the profile is built.</p>
                </Panel>
              )}
            </div>
          </TabsContent>

          <footer className="mt-6 px-1 text-[13px] text-muted-foreground">
            Profile v{data.profile.version}, built from {num(s.n)} {data.profile.fromPaste ? "pasted" : "original"} posts
            {s.span && (
              <>
                {" "}
                from <LocalTime iso={s.span.from} dateOnly /> to <LocalTime iso={s.span.to} dateOnly />
              </>
            )}
            .{data.profile.droppedClaims > 0 && ` Code dropped ${data.profile.droppedClaims} claim${data.profile.droppedClaims === 1 ? "" : "s"} it couldn't verify.`}
          </footer>
        </div>
      </Sheet>
    </Tabs>
  );
}
