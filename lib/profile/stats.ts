import { BINARY_FEATURES, type BinaryFeature, emojis, features, quantile } from "@/lib/text";

export type Confidence = "low" | "medium" | "high";

export type Stats = {
  n: number;
  quoteRate: number;
  span: { from: string; to: string } | null;
  length: { p10: number; p50: number; p90: number };
  medianWords: number;
  medianSentences: number;
  /** Share of posts with each binary feature (raw, 0..1). */
  rates: Record<BinaryFeature, number>;
  /** 90th percentile counts per post: used as person-calibrated caps. */
  p90: { hashtags: number; emoji: number; emDash: number };
  topEmoji: string[];
  confidence: Confidence;
};

export type CorpusPost = { text: string; kind: "original" | "quote"; postedAt: Date | null };

export const confidenceFor = (n: number): Confidence => (n < 20 ? "low" : n < 80 ? "medium" : "high");

const sortedOf = (xs: number[]) => [...xs].sort((a, b) => a - b);

export function computeStats(posts: CorpusPost[]): Stats {
  const fs = posts.map((p) => features(p.text));
  const n = fs.length;
  const col = (pick: (f: (typeof fs)[number]) => number) => sortedOf(fs.map(pick));
  const lengths = col((f) => f.length);
  const rates = Object.fromEntries(
    BINARY_FEATURES.map((k) => [k, n ? fs.filter((f) => f[k]).length / n : 0]),
  ) as Record<BinaryFeature, number>;

  const emojiCounts = new Map<string, number>();
  posts.flatMap((p) => emojis(p.text)).forEach((e) => emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1));
  const dates = posts.map((p) => p.postedAt?.getTime()).filter((d): d is number => !!d).sort((a, b) => a - b);

  return {
    n,
    quoteRate: n ? posts.filter((p) => p.kind === "quote").length / n : 0,
    span: dates.length ? { from: new Date(dates[0]).toISOString(), to: new Date(dates.at(-1)!).toISOString() } : null,
    length: { p10: quantile(lengths, 0.1), p50: quantile(lengths, 0.5), p90: quantile(lengths, 0.9) },
    medianWords: quantile(col((f) => f.words), 0.5),
    medianSentences: quantile(col((f) => f.sentences), 0.5),
    rates,
    p90: {
      hashtags: Math.round(quantile(col((f) => f.hashtags), 0.9)),
      emoji: Math.round(quantile(col((f) => f.emoji), 0.9)),
      emDash: Math.round(quantile(col((f) => f.emDash), 0.9)),
    },
    topEmoji: [...emojiCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e]) => e),
    confidence: confidenceFor(n),
  };
}

/** Countable patterns the person uses in >= 10% of posts: the judge is told not to flag these. */
const HABIT_LABELS: Partial<Record<BinaryFeature, string>> = {
  hasEmDash: "em dashes",
  hasEmoji: "emoji",
  exclamation: "exclamation marks",
  ellipsis: "'..' or '...' pauses",
  lowercaseStart: "lowercase sentence starts",
  questionEnd: "ending on a question",
  hasHashtag: "hashtags",
  noTerminalPunct: "no final punctuation",
  list: "list formatting",
};

export const habits = (s: Stats) =>
  (Object.keys(HABIT_LABELS) as BinaryFeature[])
    .filter((k) => s.rates[k] >= 0.1)
    .map((k) => `${HABIT_LABELS[k]} (${Math.round(s.rates[k] * 100)}% of posts)`);
