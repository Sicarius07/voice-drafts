import { describe, expect, it } from "vitest";
import { hintsFor, splitHints, withFilled } from "@/lib/generate/placeholders";
import { cleanup, nearCopy, validate } from "@/lib/generate/validate";
import { splitPasted } from "@/lib/text";

describe("validate", () => {
  const ctx = { notes: "", corpus: ["the best founders ship small things every single day without asking anyone"] };

  it("catches near-copies and unknown brackets", () => {
    const codes = (t: string) => validate(t, ctx).errors.map((e) => e.code);
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

describe("placeholder hints", () => {
  const draft = "[Your number: speedup on your serving path]x faster, measured on [your metric: what you timed] and [your number: batch size]";

  it("moves hints out of the text", () => {
    const { text, hints } = splitHints(draft);
    expect(text).toBe("[your number]x faster, measured on [your metric] and [your number]");
    expect(hints.map((h) => h.hint)).toEqual(["speedup on your serving path", "what you timed", "batch size"]);
    expect(validate(text, { notes: "", corpus: [] }).errors).toEqual([]);
  });

  it("fills one placeholder and keeps the others' hints lined up", () => {
    const { text, hints } = splitHints(draft);
    const filled = withFilled(text, hints, 0, "3")!;
    expect(filled.text).toBe("3x faster, measured on [your metric] and [your number]");
    expect(hintsFor(filled.text, filled.hints)).toEqual(["what you timed", "batch size"]);
    expect(withFilled(filled.text, filled.hints, 5, "x")).toBeNull();
  });
});

describe("splitPasted", () => {
  it("splits on blank lines, or only on --- lines when there are any", () => {
    expect(splitPasted("one\n\ntwo\n\nthree")).toEqual(["one", "two", "three"]);
    expect(splitPasted("first para\n\nsecond para\n---\nnext post")).toEqual(["first para\n\nsecond para", "next post"]);
  });
});
