import { describe, expect, it } from "vitest";
import { verifyQualities, type RawQualities } from "@/lib/profile/qualities";
import { computeStats, confidenceFor, habits } from "@/lib/profile/stats";
import { typicalityDistribution, voiceMatch } from "@/lib/profile/voice-match";

const post = (text: string) => ({ text, kind: "original" as const, postedAt: new Date("2026-05-01") });
const corpus = [
  "shipped the new pricing page today",
  "shipped a tiny fix — finally",
  "most people overthink pricing",
  "shipped another experiment, 3 signups",
  "pricing is a product decision not a finance one",
  "slow week. shipped nothing",
].map(post);

describe("computeStats", () => {
  const s = computeStats(corpus);
  it("measures rates and length percentiles", () => {
    expect(s.n).toBe(6);
    expect(s.rates.lowercaseStart).toBe(1);
    expect(s.rates.hasEmDash).toBeCloseTo(1 / 6);
    expect(s.length.p10).toBeLessThanOrEqual(s.length.p50);
    expect(s.length.p50).toBeLessThanOrEqual(s.length.p90);
  });
  it("derives confidence and habits", () => {
    expect(confidenceFor(10)).toBe("low");
    expect(confidenceFor(50)).toBe("medium");
    expect(confidenceFor(120)).toBe("high");
    expect(habits(s).join(" ")).toContain("lowercase");
  });
});

describe("verifyQualities", () => {
  const posts = corpus.map((p, i) => ({ id: `x${i}`, text: p.text }));
  const raw: RawQualities = {
    persona: "indie founder",
    audience: "builders",
    topics: [
      { label: "pricing", ids: ["t1", "t3", "t5"] },
      { label: "made up", ids: ["t99"] },
    ],
    tone: [{ descriptor: "dry", ids: ["t6"] }],
    phrases: ["shipped", "synergy"],
    openers: ["most people"],
    closers: [],
    positions: [{ claim: "pricing is product", ids: ["t3", "t5"] }],
    never_uses: ["leverage", "pricing"],
    signature_ids: ["t2", "t42"],
  };
  const v = verifyQualities(raw, posts);

  it("keeps grounded claims and tags posts", () => {
    expect(v.qualities.topics).toEqual([{ label: "pricing", count: 3 }]);
    expect(v.topicTags.get("x0")).toEqual(["pricing"]);
    expect(v.qualities.phrases).toEqual([{ text: "shipped", count: 4 }]);
    expect(v.qualities.neverUses).toEqual(["leverage"]);
    expect(v.qualities.signatureIds).toEqual(["x1"]);
  });

  it("drops and counts unverifiable claims", () => {
    // made-up topic, "synergy", "most people" (1 occurrence), "pricing" in never_uses
    expect(v.dropped).toBe(4);
  });
});

describe("voiceMatch", () => {
  const s = computeStats(corpus);
  const dist = typicalityDistribution(corpus.map((p) => p.text), s);
  it("scores typical drafts above atypical ones", () => {
    const typical = voiceMatch("shipped the onboarding flow today", s, dist);
    const atypical = voiceMatch("Excited to announce our NEW product!!! 🚀🚀 #launch #startup Thoughts?", s, dist);
    expect(typical.score).toBeGreaterThan(atypical.score);
    expect(atypical.deviations.length).toBeGreaterThan(0);
  });
  it("counts list formatting for someone who never writes lists", () => {
    const list = voiceMatch("shipped three things today:\n- pricing page\n- onboarding\n- a tiny fix", s, dist);
    expect(list.deviations.some((d) => d.startsWith("uses list formatting"))).toBe(true);
  });
});
