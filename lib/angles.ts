// Ported from x-skills by Sergey Bulaev (MIT), references/hook-formulas.md @ ea61d1d.
// Changes: single-tweet formulas only (X4 quote-tweet and X7-X10 thread formulas excluded); the X3 skeleton
// is rewritten because its "Here is the part nobody tweets:" line is a reveal bridge under x-skills' own
// scrub rules; engagement-bait CTAs are dropped.

export const GOALS = ["replies", "reposts", "likes", "bookmarks"] as const;
export type Goal = (typeof GOALS)[number];

type Formula = { name: string; goals: Goal[]; skeleton: string; why: string; needsThirdPartyResult?: boolean };

export const FORMULAS = {
  X1: {
    name: "One-liner contrarian",
    goals: ["reposts", "replies"],
    skeleton: "Most {group} think {common belief}.\n\nThe ones who {win} do the opposite: {contrarian move}.\n\n(or one flat, defensible claim with no hedge)",
    why: "A complete, screenshot-ready opinion travels; it must be true enough to defend in the replies.",
  },
  X2: {
    name: "Data-point hook",
    goals: ["bookmarks"],
    skeleton: "{specific number} {what it measures}.\n\n{one line of context that makes the number land}",
    why: "One hard number is the most save-worthy unit. Use a number from the notes, or [your number].",
  },
  X3: {
    name: "Build-in-public",
    goals: ["replies"],
    skeleton: "{time marker}: {project} did {real metric, good or bad}.\n\n{the cost, mistake or surprise behind it, stated flat}",
    why: "A real number from their own work, including ugly ones, invites builders to compare notes. Use [your metric] if the notes have none.",
  },
  X5: {
    name: "Mini-list",
    goals: ["bookmarks"],
    skeleton: "{N} {things} that {payoff}:\n\n1. {item}\n2. {item}\n3. {item}",
    why: "A self-contained, scannable list is bookmark-bait. Few words per item; three real items beat five weak ones.",
  },
  X6: {
    name: "Relatable cold-open",
    goals: ["likes"],
    skeleton: "{one short line that drops the reader straight into a specific shared moment}",
    why: "Recognition is instant; specificity is the whole job.",
  },
  X11: {
    name: "Third-person case study",
    goals: ["reposts", "bookmarks"],
    skeleton: "{a person or company from the notes} {achieved a specific outcome} {doing something ordinary}.\n\n{one line on why anyone could copy it}",
    why: "Someone else's specific result, framed as copyable. Only with a real result from the notes.",
    needsThirdPartyResult: true,
  },
} as const satisfies Record<string, Formula>;

export type FormulaId = keyof typeof FORMULAS;
export const FORMULA_IDS = Object.keys(FORMULAS) as FormulaId[];

/** Notes describe someone else's result: a number plus a name (an @mention, or a capitalized word mid-sentence). */
const hasThirdPartyResult = (notes: string) => /\d/.test(notes) && /@\w+|[a-z,]\s+[A-Z][a-z]+/.test(notes);

export function eligibleFormulas(goal: Goal | "any", notes: string): FormulaId[] {
  return FORMULA_IDS.filter((id) => {
    const f: Formula = FORMULAS[id];
    return (goal === "any" || f.goals.includes(goal)) && (!f.needsThirdPartyResult || hasThirdPartyResult(notes));
  });
}

export const angleBrief = (id: FormulaId) => {
  const f: Formula = FORMULAS[id];
  return `ANGLE: ${f.name} (goal: ${f.goals.join(" / ")})\nWhy it works: ${f.why}\nSkeleton (a shape, not text to copy):\n${f.skeleton}`;
};
