import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { engagementPercentiles, selectExamples } from "@/lib/generate/examples";
import { PROMPTS } from "@/server/llm/prompts";
import { decodeEntities, normalizePost, usablePosts } from "@/server/x/normalize";

describe("normalizePost", () => {
  const media = new Map([["3_1", { media_key: "3_1", type: "photo", url: "https://pbs.twimg.com/a.jpg", alt_text: "chart" }]]);

  it("decodes entities, strips media and quote links, expands other links", () => {
    const p = normalizePost(
      {
        id: "1",
        text: "Q&amp;A: is it worth it? https://t.co/link https://t.co/pic https://t.co/quote",
        attachments: { media_keys: ["3_1"] },
        entities: {
          urls: [
            { url: "https://t.co/link", expanded_url: "https://example.com/post" },
            { url: "https://t.co/pic", expanded_url: "https://x.com/a/status/9/photo/1", media_key: "3_1" },
            { url: "https://t.co/quote", expanded_url: "https://x.com/someone/status/123" },
          ],
        },
      },
      media,
    );
    expect(p.text).toBe("Q&A: is it worth it? https://example.com/post");
    expect(p.kind).toBe("quote");
    expect(p.media).toEqual([{ type: "photo", url: "https://pbs.twimg.com/a.jpg", altText: "chart", width: null, height: null }]);
  });

  it("prefers the full note text for long posts and flags media-only posts", () => {
    expect(normalizePost({ id: "2", text: "short…", note_post: { text: "the full long text" } }, new Map()).text).toBe("the full long text");
    expect(normalizePost({ id: "3", text: "this.", attachments: { media_keys: ["3_1"] } }, media).mediaDependent).toBe(true);
  });

  it("decodes &amp; last", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("keeps the dominant language", () => {
    const mk = (id: string, lang: string) => ({ ...normalizePost({ id, text: "hi", lang }, new Map()) });
    expect(usablePosts([mk("1", "en"), mk("2", "en"), mk("3", "ja")]).map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("examples", () => {
  const m = (likes: number, bookmarks: number) => ({ like_count: likes, reply_count: 0, repost_count: 0, quote_count: 0, bookmark_count: bookmarks, impression_count: 1000 });
  const old = new Date("2026-01-01");
  it("ranks engagement within the person's own posts, ignoring unsettled ones", () => {
    const e = engagementPercentiles(
      [
        { id: "a", metrics: m(1, 0), postedAt: old },
        { id: "b", metrics: m(50, 9), postedAt: old },
        { id: "c", metrics: m(500, 90), postedAt: new Date() },
      ],
      Date.now(),
    );
    expect(e.get("b")!.likes).toBeGreaterThan(e.get("a")!.likes);
    expect(e.has("c")).toBe(false);
  });
  it("ranks by count, so a post that reached far more people isn't buried by a lower rate", () => {
    const viral = { id: "v", metrics: { ...m(14593, 0), impression_count: 7_262_251 }, postedAt: old };
    const niche = { id: "n", metrics: { ...m(1073, 0), impression_count: 177_781 }, postedAt: old };
    const e = engagementPercentiles([viral, niche], Date.now());
    expect(e.get("v")!.likes).toBeGreaterThan(e.get("n")!.likes);
  });
  it("selects by topic + engagement and skips media-only posts", () => {
    const posts = [
      { id: "1", text: "pricing thoughts one", topicTags: ["pricing"], engagement: null, mediaDependent: false },
      { id: "2", text: "hiring is hard", topicTags: ["hiring"], engagement: null, mediaDependent: false },
      { id: "3", text: "pricing pic", topicTags: ["pricing"], engagement: null, mediaDependent: true },
    ];
    expect(selectExamples(posts, { topic: "pricing", goal: "any", k: 1 }).map((p) => p.id)).toEqual(["1"]);
  });
});

/** Prompt texts are pinned to their versions: change a prompt → bump its version → update the hash here. */
const PINNED: Record<string, string> = {
  "profile-v1": "e74d9206b11a",
  "gen-v1": "68616796c639",
  "judge-v1": "9378fee8dd57",
  "humanize-v2": "269d67837f27",
  "rules-v1": "d59e141e22d7",
};

describe("prompt versions", () => {
  it.each(Object.values(PROMPTS))("$version matches its pinned hash", ({ version, instructions }) => {
    const hash = createHash("sha256").update(instructions).digest("hex").slice(0, 12);
    expect(PINNED[version], `unknown or changed prompt ${version}: pin "${hash}"`).toBe(hash);
  });
});
