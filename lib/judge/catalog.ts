// Ported from x-skills by Sergey Bulaev (MIT): skills/x-humanizer/references/scrub-rules.md and
// skills/x-humanizer/references/audit-checklist.md @ ea61d1d.
// Changes: the vendor's corpus statistics are removed (thresholds are kept as heuristics, not facts);
// patterns are grouped into a fixed category enum whose severity is decided here, never by the LLM.

export type Severity = "blocker" | "warning";

/** Categories the LLM judge may flag. */
export const LLM_TELLS = {
  reveal_bridge: {
    severity: "blocker",
    label: "Reveal bridge",
    rule: 'A setup line that withholds then reveals: "Here\'s what/how/why…", "The result?", "Stop X, start Y", "Plot twist:". Delete the bridge and let the next sentence stand.',
  },
  negative_parallelism: {
    severity: "blocker",
    label: "Negative parallelism",
    rule: '"It\'s not X, it\'s Y", "This isn\'t X. This is Y.", "The question isn\'t X, it\'s Y" and siblings.',
  },
  sincerity_marker: {
    severity: "blocker",
    label: "Performed sincerity",
    rule: 'Announced candor as opener or pivot: "let me be honest", "I\'ll be real", "honestly?", "real talk", "not gonna lie", "ngl", "unpopular opinion:" on a popular take.',
  },
  dead_opener: {
    severity: "blocker",
    label: "Dead opener",
    rule: '"In today\'s fast-paced world", "in the age of AI", "In a world where…".',
  },
  dead_closer_or_bait: {
    severity: "blocker",
    label: "Dead closer / bait",
    rule: '"What do you think?", "Thoughts?", "Let me know in the replies", "Tag someone who…", "Let that sink in.", "RT if…", "reply YES".',
  },
  marker_cluster: {
    severity: "blocker",
    label: "AI vocabulary cluster",
    rule: "3 or more AI-vocabulary or grammar markers in the same post (one is fine). Markers: significant, crucial, notably, particularly, comprehensive, holistic, insight(s), robust, leverage, foster, landscape, nuanced, multifaceted, streamline, elevate, empower, utilize, harness, facilitate, unlock, navigate (figurative), seamless, ecosystem, delve, tapestry, realm, journey, paradigm, cultivate, fundamentally, essentially, ultimately, crucially, arguably, undoubtedly; sentence-opening '-ing' clauses; 'the <noun>-tion of' nominalisations. Quote the span covering the markers.",
  },
  staccato: {
    severity: "warning",
    label: "Staccato stack",
    rule: 'Fragment runs for drama: "Short. Punchy. Done.", "No X. No Y. Just Z.", "All the X. None of the Y.", one-word lines ("Still."), pseudo-Socratic "Why? Because…".',
  },
  hollow_triad: {
    severity: "warning",
    label: "Hollow or stacked triad",
    rule: 'A rule-of-three of interchangeable abstractions ("faster, cheaper, better"), or a second triad in the same post. One concrete triad is fine.',
  },
  inserted_hedge: {
    severity: "warning",
    label: "Inserted hedge",
    rule: '"perhaps", "it seems", "I might be wrong but", "in my humble opinion" used as filler.',
  },
  dead_phrase: {
    severity: "warning",
    label: "Dead phrase",
    rule: '"game-changer", "deep dive", "move the needle", "at the end of the day", "paradigm shift", "the hard truth is".',
  },
  model_idiom: {
    severity: "warning",
    label: "Model idiom",
    rule: '"quietly <verb>ed", "X matters." as its own line, "built different", "load-bearing", "doing the heavy lifting", "that\'s the real story".',
  },
  weak_first_line: {
    severity: "warning",
    label: "Weak first line",
    rule: "The first line needs the second line to make sense (there is no fold on X).",
  },
} as const satisfies Record<string, { severity: Severity; label: string; rule: string }>;

/** Categories found by code (the deterministic layer). */
export const CODE_TELLS = {
  hashtags: { severity: "warning", label: "Hashtags beyond their habit" },
  emoji: { severity: "warning", label: "Emoji beyond their habit" },
  em_dash: { severity: "warning", label: "Em dashes beyond their habit" },
  dashes: { severity: "warning", label: "En dash or double hyphen" },
  leakage: { severity: "blocker", label: "Model leakage" },
} as const satisfies Record<string, { severity: Severity; label: string }>;

export type LlmCategory = keyof typeof LLM_TELLS;
export type CodeCategory = keyof typeof CODE_TELLS;
export type TellCategory = LlmCategory | CodeCategory;
export const LLM_CATEGORIES = Object.keys(LLM_TELLS) as [LlmCategory, ...LlmCategory[]];

const ALL = { ...LLM_TELLS, ...CODE_TELLS } as Record<TellCategory, { severity: Severity; label: string }>;
export const severityOf = (c: TellCategory) => ALL[c].severity;
export const labelOf = (c: TellCategory) => ALL[c].label;

export const rubric = () =>
  (Object.entries(LLM_TELLS) as [LlmCategory, (typeof LLM_TELLS)[LlmCategory]][])
    .map(([k, v]) => `- ${k} (${v.severity}): ${v.rule}`)
    .join("\n");

/** Not tells (from the x-skills "preserve" list): never flag these. */
export const PRESERVE =
  "lowercase-casual register; '..' soft pauses; one em dash; one concrete triad; uniform rhythm in a single post; contractions; " +
  "specific numbers and names; blunt opinions; a single common marker word; placeholders like [your number].";
