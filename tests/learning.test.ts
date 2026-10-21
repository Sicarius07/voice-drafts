import { describe, expect, it } from "vitest";
import { eligibleFormulas, FORMULAS } from "@/lib/angles";
import { pickAngles, posteriorMean, sampleBeta, updatePosterior } from "@/lib/learning/bandit";
import { editBurden, hunks } from "@/lib/learning/diff";
import { abTally, qualitySeries, wilson } from "@/lib/learning/metrics";
import {
  contradictedBy,
  renderRules,
  sameRule,
  snapshotOf,
  verifyProposal,
  withContradiction,
  withSupport,
  type Proposal,
  type Rule,
} from "@/lib/learning/rules";

const seeded = (seed = 42) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "r1",
  kind: "no_question_ending",
  params: {},
  text: "Don't end on a question",
  status: "candidate",
  evidenceCount: 1,
  contradictionCount: 0,
  archivedReason: null,
  ...over,
});

describe("diff", () => {
  it("finds edit hunks and ignores placeholder fills", () => {
    const hs = hunks("we hit [your number] users. What do you think?", "we hit 40 users.");
    expect(hs).toHaveLength(1);
    expect(hs[0].removed).toContain("What do you think?");
  });
  it("measures edit burden in [0, 1]", () => {
    expect(editBurden("same text", "same text")).toBe(0);
    expect(editBurden("a b c d", "a b c d e f")).toBeGreaterThan(0);
    expect(editBurden("[your number] users", "40 users")).toBe(0);
  });
});

describe("verifyProposal", () => {
  const shown = "shipping fast matters. What do you think?";
  const kept = "shipping fast matters.";
  const style = hunks(shown, kept);
  const p = (over: Partial<Proposal>): Proposal => ({ kind: "no_question_ending", params: {}, hunkIds: [style[0].id], ...over });

  it("accepts a detector the edit actually proves", () => {
    expect(verifyProposal(p({}), shown, kept, style)).toBe(true);
    expect(verifyProposal(p({ kind: "avoid_phrase", params: { phrase: "what do you think" } }), shown, kept, style)).toBe(true);
  });
  it("rejects detectors the edit doesn't prove, and bad citations", () => {
    expect(verifyProposal(p({ kind: "no_emoji" }), shown, kept, style)).toBe(false);
    expect(verifyProposal(p({ kind: "avoid_phrase", params: { phrase: "shipping" } }), shown, kept, style)).toBe(false);
    expect(verifyProposal(p({ hunkIds: [99] }), shown, kept, style)).toBe(false);
    expect(verifyProposal(p({ kind: "max_chars", params: { n: 10 } }), shown, kept, style)).toBe(false);
  });
  it("accepts style notes without a detector", () => {
    expect(verifyProposal(p({ kind: "style_note", params: { note: "drier tone" } }), shown, kept, style)).toBe(true);
  });
});

describe("rule lifecycle", () => {
  it("activates a candidate on its second piece of evidence", () => {
    expect(withSupport(rule()).status).toBe("active");
  });
  it("archives candidates on one contradiction, active rules on two", () => {
    expect(withContradiction(rule()).status).toBe("archived");
    const active = rule({ status: "active", evidenceCount: 3 });
    expect(withContradiction(active).status).toBe("active");
    expect(withContradiction(withContradiction(active)).status).toBe("archived");
  });
  it("detects a contradiction only when the user puts the pattern back", () => {
    expect(contradictedBy(rule(), "all good.", "all good?")).toBe(true);
    expect(contradictedBy(rule(), "all good?", "still good?")).toBe(false);
  });
  it("dedupes by kind and phrase", () => {
    expect(sameRule({ kind: "avoid_phrase", params: { phrase: "Game-changer" } }, { kind: "avoid_phrase", params: { phrase: "game-changer" } })).toBe(true);
    expect(sameRule({ kind: "avoid_phrase", params: { phrase: "a" } }, { kind: "avoid_phrase", params: { phrase: "b" } })).toBe(false);
  });
  it("renders active rules and tentative ones separately; snapshots skip archived", () => {
    const rules = [rule({ status: "active", id: "a" }), rule({ id: "b", kind: "no_emoji", text: "No emoji" }), rule({ id: "c", status: "archived" })];
    const out = renderRules(rules);
    expect(out).toContain("Rules (follow these):\n- Don't end on a question");
    expect(out).toContain("Tentative (seen once; lean toward these):\n- No emoji");
    expect(snapshotOf(rules).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("bandit", () => {
  it("picks distinct eligible angles and favors winners", () => {
    const eligible = eligibleFormulas("any", "");
    expect(eligible).not.toContain("X11"); // needs someone else's result in the notes
    expect(eligibleFormulas("any", "we launched referrals, 12 signups")).not.toContain("X11");
    expect(eligibleFormulas("any", "a dentist in Ohio made $40k from one blog post")).toContain("X11");
    const picks = pickAngles({}, eligible, 3, { rng: seeded() });
    expect(new Set(picks).size).toBe(3);
    let wins = 0;
    for (let i = 0; i < 200; i++) if (pickAngles({ X5: { alpha: 20, beta: 2 } }, eligible, 1, { rng: seeded(i + 1) })[0] === "X5") wins++;
    expect(wins).toBeGreaterThan(120); // P(win) ≈ 0.7 vs four uniform arms
  });
  it("fills a batch with other goals' angles when the goal has too few", () => {
    const picks = pickAngles({}, eligibleFormulas("likes", ""), 3, { fallback: eligibleFormulas("any", ""), rng: seeded() });
    expect(picks[0]).toBe("X6"); // the only likes angle comes first
    expect(new Set(picks).size).toBe(3);
  });
  it("updates posteriors fractionally", () => {
    const p = updatePosterior({ alpha: 1, beta: 1 }, 0.5, 1);
    expect(p).toEqual({ alpha: 1.5, beta: 1.5 });
    expect(posteriorMean(p)).toBe(0.5);
    const s = sampleBeta({ alpha: 2, beta: 5 }, seeded());
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("metrics", () => {
  it("computes Wilson intervals and A/B tallies", () => {
    const [lo, hi] = wilson(7, 10);
    expect(lo).toBeGreaterThan(0.39);
    expect(hi).toBeLessThan(0.9);
    const t = abTally(["learned", "learned", "baseline", "tie"]);
    expect(t).toMatchObject({ learned: 2, baseline: 1, tie: 1, decided: 3 });
  });
  it("rolls acceptance and words kept over batches", () => {
    const s = qualitySeries([
      { shown: 3, accepted: 0, burdens: [0.6] },
      { shown: 3, accepted: 3, burdens: [] },
    ]);
    expect(s[1].acceptance).toBe(0.5);
    expect(s[1].kept).toBeCloseTo(0.4);
  });
});

describe("ported hook skeletons", () => {
  it("contain no reveal bridges (x-skills' own blocker)", () => {
    for (const f of Object.values(FORMULAS)) expect(f.skeleton).not.toMatch(/here(?:'s| is) (?:what|how|why|the part)|the result\?|plot twist/i);
  });
});
