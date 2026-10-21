import { describe, expect, it } from "vitest";
import { cleanup, nearCopy, validate } from "@/lib/generate/validate";

describe("validate", () => {
  const ctx = { notes: "", corpus: ["the best founders ship small things every single day without asking anyone"] };

  it("catches length, near-copies and unknown brackets", () => {
    const codes = (t: string) => validate(t, ctx).errors.map((e) => e.code);
    expect(codes("x".repeat(281))).toContain("length");
    expect(codes("honestly the best founders ship small things every single day without asking")).toContain("near_copy");
    expect(codes("hi [Your Name]")).toContain("placeholder");
    expect(codes("shipping small beats shipping big")).toEqual([]);
  });

  it("warns (doesn't block) on unknown names", () => {
    const v = validate("met Jane Doe at the meetup", ctx);
    expect(v.errors).toEqual([]);
    expect(v.warnings[0].items).toEqual(["Jane Doe"]);
  });
});

describe("cleanup + nearCopy", () => {
  it("strips preambles and wrapping quotes", () => {
    expect(cleanup('Here\'s a tweet:\n"shipping beats planning"')).toBe("shipping beats planning");
  });
  it("returns null for original text", () => {
    expect(nearCopy("a completely new idea about pricing pages", ["nothing alike here at all"])).toBeNull();
  });
});
