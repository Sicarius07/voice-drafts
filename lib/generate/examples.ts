import { GOALS, type Goal } from "@/lib/angles";
import { percentileRank, words } from "@/lib/text";

export type Metrics = {
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  bookmark_count: number;
  impression_count: number;
};
export type Engagement = Record<Goal | "overall", number>;

const MIN_AGE_MS = 48 * 3600 * 1000; // younger metrics haven't settled

const GOAL_COUNT: Record<Goal, (m: Metrics) => number> = {
  replies: (m) => m.reply_count,
  reposts: (m) => m.repost_count + m.quote_count,
  likes: (m) => m.like_count,
  bookmarks: (m) => m.bookmark_count,
};

/**
 * Per-goal engagement percentile within the person's own posts, by raw count. A count is reach × conversion,
 * so a post that reached more people and still converted them ranks higher (a per-impression rate would rank
 * their most-liked post near the bottom).
 */
export function engagementPercentiles(posts: { id: string; metrics: Metrics | null; postedAt: Date | null }[], now = Date.now()) {
  const settled = posts.filter((p) => p.metrics && (!p.postedAt || now - p.postedAt.getTime() >= MIN_AGE_MS));
  const sorted = Object.fromEntries(GOALS.map((g) => [g, settled.map((p) => GOAL_COUNT[g](p.metrics!)).sort((a, b) => a - b)])) as Record<Goal, number[]>;
  return new Map(
    settled.map((p) => {
      const byGoal = Object.fromEntries(GOALS.map((g) => [g, percentileRank(sorted[g], GOAL_COUNT[g](p.metrics!))])) as Record<Goal, number>;
      const overall = GOALS.reduce((s, g) => s + byGoal[g], 0) / GOALS.length;
      return [p.id, { ...byGoal, overall }];
    }),
  );
}

export type ExamplePost = { id: string; text: string; topicTags: string[]; engagement: Engagement | null; mediaDependent: boolean };

const overlap = (a: string, b: string) => {
  const A = new Set(words(a));
  const B = new Set(words(b));
  return [...A].filter((w) => B.has(w)).length / Math.max(1, Math.min(A.size, B.size));
};

/** Simple selection: half topic match, half engagement for the chosen goal; skip near-duplicates. */
export function selectExamples(posts: ExamplePost[], opts: { topic: string | null; goal: Goal | "any"; k?: number }): ExamplePost[] {
  const key = opts.goal === "any" ? "overall" : opts.goal;
  const scored = posts
    .filter((p) => !p.mediaDependent)
    .map((p) => ({ p, score: 0.5 * (opts.topic && p.topicTags.includes(opts.topic) ? 1 : 0) + 0.5 * (p.engagement?.[key] ?? 0.5) }))
    .sort((a, b) => b.score - a.score);
  const picked: ExamplePost[] = [];
  for (const { p } of scored) {
    if (picked.length >= (opts.k ?? 6)) break;
    if (picked.every((q) => overlap(p.text, q.text) <= 0.5)) picked.push(p);
  }
  return picked;
}

export const engagementLabel = (e: Engagement | null, goal: Goal | "any") => {
  if (!e) return "";
  const p = e[goal === "any" ? "overall" : goal];
  return `top ${Math.max(1, Math.round((1 - p) * 100))}% of their posts${goal === "any" ? "" : ` for ${goal}`}`;
};
