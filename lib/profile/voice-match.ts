import { features, percentileRank, type Features } from "@/lib/text";
import type { Stats } from "./stats";

const MATCH = {
  lowercaseStart: ["starts lowercase", "starts with a capital"],
  noTerminalPunct: ["ends without punctuation", "ends with punctuation"],
  hasEmoji: ["uses emoji", "has no emoji"],
  hasHashtag: ["uses a hashtag", "has no hashtag"],
  hasEmDash: ["uses an em dash", "has no em dash"],
  questionEnd: ["ends on a question", "doesn't end on a question"],
  contraction: ["uses contractions", "has no contractions"],
  list: ["uses list formatting", "has no list formatting"],
} as const; // style only: numbers, links and mentions are content and come from the user's notes
type MatchKey = keyof typeof MATCH;

type Score = { key: MatchKey | "length"; score: number; note: string };

function scores(f: Features, s: Stats): Score[] {
  const { p10, p50, p90 } = s.length;
  const off = f.length < p10 ? p10 - f.length : f.length > p90 ? f.length - p90 : 0;
  const length: Score = {
    key: "length",
    score: 1 - Math.min(1, off / Math.max(20, p50)),
    note: f.length > p90 ? "longer than 90% of their posts" : "shorter than 90% of their posts",
  };
  // Relative likelihood: their usual choice scores 1, the other choice scores (its rate / the usual rate),
  // so a 40/60 habit barely matters and a 3/97 one matters a lot.
  const binary = (Object.keys(MATCH) as MatchKey[]).map((k): Score => {
    const p = (s.rates[k] * s.n + 1) / (s.n + 2); // Laplace-smoothed rate
    const observed = f[k] ? p : 1 - p;
    return { key: k, score: observed / Math.max(p, 1 - p), note: `${MATCH[k][f[k] ? 0 : 1]} (only ${Math.round(observed * 100)}% of their posts do)` };
  });
  return [length, ...binary];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const typicality = (text: string, s: Stats) => mean(scores(features(text), s).map((x) => x.score));

/** Sorted typicality of the person's own posts: the reference distribution for voice match. */
export const typicalityDistribution = (texts: string[], s: Stats) => texts.map((t) => typicality(t, s)).sort((a, b) => a - b);

export type VoiceMatch = { score: number; deviations: string[] };

/** "72" = more typical of them than 72% of their own posts. */
export function voiceMatch(text: string, s: Stats, distribution: number[]): VoiceMatch {
  const sc = scores(features(text), s);
  return {
    score: Math.round(percentileRank(distribution, mean(sc.map((x) => x.score))) * 100),
    deviations: sc.filter((x) => x.score < 0.6).sort((a, b) => a.score - b.score).slice(0, 3).map((x) => x.note),
  };
}
