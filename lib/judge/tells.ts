import { unknownBrackets } from "@/lib/text";
import { labelOf, severityOf, type CodeCategory, type LlmCategory, type Severity, type TellCategory } from "./catalog";

export type Tell = {
  category: TellCategory;
  start: number;
  end: number;
  text: string;
  explanation: string;
  severity: Severity;
  /** flagged = counts toward the meter; noted = the person does this too; suppressed = user allowlisted it. */
  status: "flagged" | "noted" | "suppressed";
};

export type RawFlag = {
  category: LlmCategory;
  span: string;
  occurrence: number | null;
  explanation: string;
  person_uses_this: boolean;
};

const tell = (category: TellCategory, start: number, end: number, text: string, explanation = labelOf(category)): Tell => ({
  category,
  start,
  end,
  text: text.slice(start, end),
  explanation,
  severity: severityOf(category),
  status: "flagged",
});

/** Lowercased, quote-straightened, whitespace-collapsed copy of `s`, plus a map back to original UTF-16 offsets. */
function normalizeWithMap(s: string) {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let ch = s[i].replace(/[“”]/, '"').replace(/[‘’]/, "'");
    if (/\s/.test(ch)) {
      if (out.endsWith(" ")) continue;
      ch = " ";
    }
    out += ch.toLowerCase();
    map.push(i);
  }
  return { out, map };
}

/**
 * Code verifies every span the judge quoted: it must exist in the draft (after normalizing quotes,
 * whitespace and case). Unfound spans are rejected and counted as hallucinated. Severity comes from
 * the catalog, never from the LLM.
 */
export function verifySpans(draft: string, flags: RawFlag[]): { tells: Tell[]; hallucinated: number } {
  const d = normalizeWithMap(draft.normalize("NFC"));
  const claimed = new Set<string>();
  const tells: Tell[] = [];
  let hallucinated = 0;
  for (const f of flags) {
    const needle = normalizeWithMap(f.span.normalize("NFC")).out.trim();
    const hits: number[] = [];
    for (let i = d.out.indexOf(needle); needle.length >= 2 && i !== -1; i = d.out.indexOf(needle, i + 1)) hits.push(i);
    const pick = f.occurrence && hits[f.occurrence - 1] !== undefined ? hits[f.occurrence - 1] : hits.find((h) => !claimed.has(`${f.category}:${h}`));
    if (pick === undefined) {
      hallucinated++;
      continue;
    }
    claimed.add(`${f.category}:${pick}`);
    const start = d.map[pick];
    const end = d.map[pick + needle.length - 1] + 1;
    if (end - start > draft.length * 0.8 && f.category !== "marker_cluster") {
      hallucinated++;
      continue;
    }
    tells.push({ ...tell(f.category, start, end, draft, f.explanation), status: f.person_uses_this ? "noted" : "flagged" });
  }
  return { tells: mergeOverlaps(tells, draft), hallucinated };
}

function mergeOverlaps(tells: Tell[], draft: string): Tell[] {
  const sorted = [...tells].sort((a, b) => a.start - b.start);
  return sorted.reduce<Tell[]>((acc, t) => {
    const prev = acc.findLast((p) => p.category === t.category && p.end > t.start);
    if (!prev) return [...acc, t];
    prev.end = Math.max(prev.end, t.end);
    prev.text = draft.slice(prev.start, prev.end);
    return acc;
  }, []);
}

export type Caps = { hashtags: number; emoji: number; emDash: number };

const LEAKAGE = /oaicite|contentReference|turn0search\d+|as of my (?:last update|knowledge cutoff)[^.\n]*|as an ai\b[^.\n]*/gi;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTO = /\p{Extended_Pictographic}/u;

/** The deterministic layer: only unambiguous, countable checks, with caps calibrated to the person. */
export function detectCodeTells(text: string, caps: Caps): Tell[] {
  const all = (re: RegExp) => [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const over = (category: CodeCategory, spans: (readonly [number, number])[], cap: number, why: string) =>
    spans.length > cap ? spans.slice(cap).map(([s, e]) => tell(category, s, e, text, why)) : [];
  const emojiSpans = [...graphemes.segment(text)]
    .filter((g) => PICTO.test(g.segment))
    .map((g) => [g.index, g.index + g.segment.length] as const);
  const bracketSpans = unknownBrackets(text).map((b) => [text.indexOf(b), text.indexOf(b) + b.length] as const);
  const why = (cap: number, things: string) => (cap ? `More ${things} than they usually use (max ${cap} per post)` : `They never use ${things}`);
  return [
    ...over("hashtags", all(/#[\p{L}\p{N}_]+/gu), caps.hashtags, why(caps.hashtags, "hashtags")),
    ...over("emoji", emojiSpans, caps.emoji, why(caps.emoji, "emoji")),
    ...over("em_dash", all(/—/g), caps.emDash, why(caps.emDash, "em dashes")),
    ...all(/ – |--/g).map(([s, e]) => tell("dashes", s, e, text, "En dash or double hyphen between clauses")),
    ...[...all(LEAKAGE), ...bracketSpans].map(([s, e]) => tell("leakage", s, e, text, "Model leakage no human types")),
  ];
}

type Habits = { p90: Caps; rates: { hasHashtag: number; hasEmoji: number; hasEmDash: number } };

/** Per-person cap for each countable pattern: 0 if they never use it, else their own 90th percentile (at least 1). */
export function capsFrom({ p90, rates }: Habits): Caps {
  const cap = (n: number, rate: number) => (rate > 0 ? Math.max(1, n) : 0);
  return { hashtags: cap(p90.hashtags, rates.hasHashtag), emoji: cap(p90.emoji, rates.hasEmoji), emDash: cap(p90.emDash, rates.hasEmDash) };
}

/** Applies the per-voice allowlist ("This is fine for them"). */
export const applyAllowlist = (tells: Tell[], allowlist: string[]): Tell[] =>
  tells.map((t) => (allowlist.includes(t.category) ? { ...t, status: "suppressed" } : t));

export type Meter = { level: "clean" | "minor" | "needs_work"; blockers: number; warnings: number };

export function meter(tells: Tell[]): Meter {
  const live = tells.filter((t) => t.status === "flagged");
  const blockers = live.filter((t) => t.severity === "blocker").length;
  const warnings = live.length - blockers;
  return { level: blockers || warnings >= 3 ? "needs_work" : warnings ? "minor" : "clean", blockers, warnings };
}

/** Humanize only when it is worth it: any blocker or 2+ warnings. */
export const needsHumanize = (m: Meter) => m.blockers > 0 || m.warnings >= 2;
