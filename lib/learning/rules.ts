import { features, normalize, weightedLength } from "@/lib/text";
import type { Hunk } from "./diff";

export type RuleParams = { phrase?: string; n?: number; note?: string };
type KindDef = { text: (p: RuleParams) => string; check: ((text: string, p: RuleParams) => boolean) | null };

/** Every learnable rule kind. `check` returns true when a text satisfies the rule; null = no detector. */
export const RULE_KINDS = {
  avoid_phrase: { text: (p) => `Don't use "${p.phrase}"`, check: (t, p) => !normalize(t).includes(normalize(p.phrase ?? "")) },
  max_chars: { text: (p) => `Keep it under ${p.n} characters`, check: (t, p) => weightedLength(t) <= (p.n ?? 280) },
  no_question_ending: { text: () => "Don't end on a question", check: (t) => !features(t).questionEnd },
  no_hashtags: { text: () => "No hashtags", check: (t) => !features(t).hasHashtag },
  no_emoji: { text: () => "No emoji", check: (t) => !features(t).hasEmoji },
  lowercase_start: { text: () => "Start in lowercase", check: (t) => features(t).lowercaseStart },
  no_terminal_period: { text: () => "Don't end with a period", check: (t) => !/\.\s*$/.test(t) },
  no_em_dash: { text: () => "No em dashes", check: (t) => !t.includes("—") },
  no_exclamation: { text: () => "No exclamation marks", check: (t) => !t.includes("!") },
  style_note: { text: (p) => p.note ?? "", check: null },
} satisfies Record<string, KindDef>;

export type RuleKind = keyof typeof RULE_KINDS;
export const RULE_KIND_IDS = Object.keys(RULE_KINDS) as [RuleKind, ...RuleKind[]];
export type RuleStatus = "candidate" | "active" | "archived";

export type Rule = {
  id: string;
  kind: RuleKind;
  params: RuleParams;
  text: string;
  status: RuleStatus;
  evidenceCount: number;
  contradictionCount: number;
  archivedReason: string | null;
  updatedAt?: Date;
};

export type Proposal = { kind: RuleKind; params: RuleParams; hunkIds: number[] };

const def = (kind: RuleKind): KindDef => RULE_KINDS[kind];
export const ruleText = (kind: RuleKind, params: RuleParams) => def(kind).text(params);
export const satisfies = (r: Pick<Rule, "kind" | "params">, text: string) => def(r.kind).check?.(text, r.params) ?? true;
export const hasDetector = (kind: RuleKind) => def(kind).check !== null;

function validParams({ kind, params }: Proposal): boolean {
  if (kind === "avoid_phrase") return !!params.phrase && params.phrase.trim().length >= 2 && params.phrase.length <= 60;
  if (kind === "max_chars") return !!params.n && params.n >= 40 && params.n <= 280;
  if (kind === "style_note") return !!params.note && params.note.length <= 140;
  return true;
}

/**
 * Code verifies a rule the LLM mined from an edit: it must cite real style hunks, and its detector must
 * be violated by the shown draft and satisfied by the kept text. Otherwise it is rejected.
 */
export function verifyProposal(p: Proposal, shown: string, kept: string, styleHunks: Hunk[]): boolean {
  const ids = new Set(styleHunks.map((h) => h.id));
  if (!p.hunkIds.length || !p.hunkIds.every((id) => ids.has(id)) || !validParams(p)) return false;
  return !hasDetector(p.kind) || (!satisfies(p, shown) && satisfies(p, kept));
}

/** Two rules are the same if they have the same kind and (for phrase/note rules) the same text. */
export const sameRule = (a: Pick<Rule, "kind" | "params">, b: Pick<Rule, "kind" | "params">) =>
  a.kind === b.kind && normalize(a.params.phrase ?? a.params.note ?? "") === normalize(b.params.phrase ?? b.params.note ?? "");

/** One more supporting edit: a candidate becomes active at 2 pieces of evidence (or on Confirm). */
export const withSupport = (r: Rule, params: RuleParams = r.params): Rule => {
  const evidenceCount = r.evidenceCount + 1;
  const status = r.status === "candidate" && evidenceCount >= 2 ? "active" : r.status;
  return { ...r, params, text: ruleText(r.kind, params), evidenceCount, status };
};

/** The user put the pattern back: candidates archive at 1 contradiction, active rules at 2. */
export const withContradiction = (r: Rule): Rule => {
  const contradictionCount = r.contradictionCount + 1;
  const archive = r.status === "candidate" || contradictionCount >= 2;
  return { ...r, contradictionCount, status: archive ? "archived" : r.status, archivedReason: archive ? "contradicted" : r.archivedReason };
};

/** A live rule is contradicted when the shown draft satisfied it and the user's edit broke it. */
export const contradictedBy = (r: Rule, shown: string, kept: string) =>
  r.status !== "archived" && hasDetector(r.kind) && satisfies(r, shown) && !satisfies(r, kept);

export const MAX_RULES_IN_PROMPT = 10;

export function rulesForPrompt(rules: Rule[]): Rule[] {
  const active = rules.filter((r) => r.status === "active").sort((a, b) => b.evidenceCount - a.evidenceCount);
  const tentative = rules
    .filter((r) => r.status === "candidate")
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return [...active, ...tentative].slice(0, MAX_RULES_IN_PROMPT);
}

export function renderRules(rules: Rule[]): string {
  const pick = rulesForPrompt(rules);
  if (!pick.length) return "";
  const section = (title: string, rs: Rule[]) => (rs.length ? `${title}\n${rs.map((r) => `- ${r.text}`).join("\n")}` : "");
  return [
    "LEARNED PREFERENCES (from this user's own edits; they override the voice card, never the hard rules)",
    section("Rules (follow these):", pick.filter((r) => r.status === "active")),
    section("Tentative (seen once; lean toward these):", pick.filter((r) => r.status === "candidate")),
  ]
    .filter(Boolean)
    .join("\n");
}

export type Snapshot = Pick<Rule, "id" | "kind" | "params" | "text" | "status">[];
export const snapshotOf = (rules: Rule[]): Snapshot =>
  rules.filter((r) => r.status !== "archived").map(({ id, kind, params, text, status }) => ({ id, kind, params, text, status }));
