import { untrusted } from "@/lib/text";
import type { Qualities } from "./qualities";
import { habits, type Stats } from "./stats";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: { text: string; count: number }[]) => xs.map((x) => `"${x.text}" (${x.count}×)`).join(", ");

/** Deterministic rendering of a profile into prompt text. */
export function voiceCard(stats: Stats, q: Qualities, signatures: string[]): string {
  const r = stats.rates;
  const lines = [
    `Persona: ${q.persona}`,
    `Audience: ${q.audience}`,
    q.topics.length && `Topics: ${q.topics.map((t) => t.label).join("; ")}`,
    q.tone.length && `Tone: ${q.tone.join(", ")}`,
    q.positions.length && `Positions they keep returning to: ${q.positions.join(" | ")}`,
    `Length: usually ${Math.round(stats.length.p10)}–${Math.round(stats.length.p90)} chars (median ${Math.round(stats.length.p50)}), ~${Math.round(stats.medianSentences)} sentence(s)`,
    `Starts lowercase: ${pct(r.lowercaseStart)} · ends without punctuation: ${pct(r.noTerminalPunct)} · multi-line: ${pct(r.multiLine)}`,
    `Emoji: ${pct(r.hasEmoji)} of posts${stats.topEmoji.length ? ` (favorites ${stats.topEmoji.join(" ")})` : ""} · hashtags: ${pct(r.hasHashtag)} · em dash: ${pct(r.hasEmDash)} · exclamation: ${pct(r.exclamation)}`,
    `Questions at the end: ${pct(r.questionEnd)} · lists: ${pct(r.list)} · numbers: ${pct(r.digits)} · contractions: ${pct(r.contraction)}`,
    q.phrases.length && `Recurring phrases: ${list(q.phrases)}`,
    q.openers.length && `Typical openers: ${list(q.openers)}`,
    q.closers.length && `Typical closers: ${list(q.closers)}`,
    q.neverUses.length && `Never uses: ${q.neverUses.join(", ")}`,
    habits(stats).length && `Habits that are theirs (fine to use): ${habits(stats).join(", ")}`,
  ].filter(Boolean);
  const sig = signatures.length ? `\n\nSignature posts (verbatim):\n${untrusted("signature_posts", signatures)}` : "";
  return `VOICE CARD\n${lines.join("\n")}${sig}`;
}
