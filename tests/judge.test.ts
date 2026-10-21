import { describe, expect, it } from "vitest";
import { applyAllowlist, capsFrom, detectCodeTells, meter, needsHumanize, verifySpans, type RawFlag } from "@/lib/judge/tells";

const flag = (span: string, extra: Partial<RawFlag> = {}): RawFlag => ({
  category: "reveal_bridge",
  span,
  occurrence: null,
  explanation: "why",
  person_uses_this: false,
  ...extra,
});

describe("verifySpans", () => {
  const draft = "Here’s what nobody tells you:  pricing is hard. It's not about price, it's about value.";

  it("finds spans despite quote and whitespace differences", () => {
    const { tells, hallucinated } = verifySpans(draft, [flag("Here's what nobody tells you: pricing")]);
    expect(hallucinated).toBe(0);
    expect(tells[0].text).toBe("Here’s what nobody tells you:  pricing");
    expect(tells[0].severity).toBe("blocker");
  });

  it("rejects spans that are not in the draft", () => {
    const { tells, hallucinated } = verifySpans(draft, [flag("this text does not exist")]);
    expect(tells).toHaveLength(0);
    expect(hallucinated).toBe(1);
  });

  it("uses occurrence for repeated substrings", () => {
    const { tells } = verifySpans("it's fine. it's fine.", [flag("it's fine", { occurrence: 2, category: "staccato" })]);
    expect(tells[0].start).toBe(11);
  });

  it("maps offsets correctly after emoji (surrogate pairs)", () => {
    const text = "🚀🚀 let that sink in";
    const { tells } = verifySpans(text, [flag("let that sink in", { category: "model_idiom" })]);
    expect(text.slice(tells[0].start, tells[0].end)).toBe("let that sink in");
  });

  it("marks patterns the person uses as noted, not flagged", () => {
    const { tells } = verifySpans(draft, [flag("pricing is hard", { category: "dead_phrase", person_uses_this: true })]);
    expect(tells[0].status).toBe("noted");
    expect(meter(tells).warnings).toBe(0);
  });
});

const habits = (rate: number, p90 = 0) => capsFrom({ p90: { hashtags: p90, emoji: p90, emDash: p90 }, rates: { hasHashtag: rate, hasEmoji: rate, hasEmDash: rate } });
const NEVER = habits(0);
const SOMETIMES = habits(0.05);

describe("detectCodeTells", () => {
  it("flags counts above the person's caps and model leakage", () => {
    const tells = detectCodeTells("big news — really — huge #a #b 🚀🚀 [Your Name]", SOMETIMES);
    const cats = tells.map((t) => t.category);
    expect(cats.filter((c) => c === "em_dash")).toHaveLength(1);
    expect(cats.filter((c) => c === "hashtags")).toHaveLength(1);
    expect(cats.filter((c) => c === "emoji")).toHaveLength(1);
    expect(cats).toContain("leakage");
  });

  it("flags any use for someone who never does it, and allows more for heavy users", () => {
    expect(detectCodeTells("shipped it — finally", NEVER).map((t) => t.explanation)).toEqual(["They never use em dashes"]);
    expect(detectCodeTells("shipped it — finally", SOMETIMES)).toHaveLength(0);
    expect(detectCodeTells("a — b — c #x #y", habits(0.4, 2))).toHaveLength(0);
  });

  it("allows placeholders", () => {
    expect(detectCodeTells("we hit [your number] users", NEVER)).toHaveLength(0);
  });
});

describe("meter + allowlist", () => {
  it("suppresses allowlisted categories", () => {
    const tells = applyAllowlist(detectCodeTells("a — b — c", NEVER), ["em_dash"]);
    expect(meter(tells).level).toBe("clean");
  });
  it("humanizes on any blocker or 2+ warnings", () => {
    expect(needsHumanize({ level: "minor", blockers: 0, warnings: 1 })).toBe(false);
    expect(needsHumanize({ level: "minor", blockers: 0, warnings: 2 })).toBe(true);
    expect(needsHumanize({ level: "needs_work", blockers: 1, warnings: 0 })).toBe(true);
  });
});
