import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FormulaId } from "@/lib/angles";
import { withFilled } from "@/lib/generate/placeholders";
import type { Posterior } from "@/lib/learning/bandit";
import { editBurden, hunks as diffHunks, type Hunk } from "@/lib/learning/diff";
import { db, t } from "@/server/db";
import { structured } from "@/server/llm/client";
import { PROMPTS } from "@/server/llm/prompts";
import {
  contradictedBy,
  ruleText,
  RULE_KIND_IDS,
  sameRule,
  snapshotOf,
  verifyProposal,
  withContradiction,
  withSupport,
  type Proposal,
  type Rule,
  type RuleKind,
  type RuleParams,
} from "@/lib/learning/rules";
import { REWARDS, type FeedbackType } from "@/lib/learning/signals";
import type { AbChoice, ClientRule, LearnedReceipt } from "@/lib/types";
import { toRule, UserError } from "./context";

/* ---------- ownership ---------- */

async function ownedDraft(userId: string, draftId: string) {
  const [row] = await db
    .select({ draft: t.drafts })
    .from(t.drafts)
    .innerJoin(t.voices, eq(t.voices.id, t.drafts.voiceId))
    .where(and(eq(t.drafts.id, draftId), eq(t.voices.userId, userId)));
  if (!row) throw new UserError("Draft not found.");
  return row.draft;
}

async function ownedVoiceId(userId: string, voiceId: string) {
  const v = await db.query.voices.findFirst({ where: and(eq(t.voices.id, voiceId), eq(t.voices.userId, userId)) });
  if (!v) throw new UserError("Voice not found.");
  return v.id;
}

async function ownedRule(userId: string, ruleId: string) {
  const [row] = await db
    .select({ rule: t.rules })
    .from(t.rules)
    .innerJoin(t.voices, eq(t.voices.id, t.rules.voiceId))
    .where(and(eq(t.rules.id, ruleId), eq(t.voices.userId, userId)));
  if (!row) throw new UserError("Rule not found.");
  return row.rule;
}

/* ---------- angle bandit ---------- */

export async function loadPosteriors(voiceId: string): Promise<Partial<Record<FormulaId, Posterior>>> {
  const rows = await db.select().from(t.angleStats).where(eq(t.angleStats.voiceId, voiceId));
  return Object.fromEntries(rows.map((r) => [r.formula, { alpha: r.alpha, beta: r.beta }]));
}

async function rewardAngle(voiceId: string, formula: FormulaId, type: FeedbackType) {
  const reward = REWARDS[type];
  if (!reward) return;
  const a = reward.weight * reward.r;
  const b = reward.weight * (1 - reward.r);
  await db
    .insert(t.angleStats)
    .values({ voiceId, formula, alpha: 1 + a, beta: 1 + b })
    .onConflictDoUpdate({
      target: [t.angleStats.voiceId, t.angleStats.formula],
      set: { alpha: sql`${t.angleStats.alpha} + ${a}`, beta: sql`${t.angleStats.beta} + ${b}` },
    });
}

/* ---------- feedback ---------- */

const logEvent = (userId: string, voiceId: string, type: FeedbackType, rest: { draftId?: string; batchId?: string; payload?: Record<string, unknown> }) =>
  db.insert(t.feedbackEvents).values({ userId, voiceId, type, ...rest, payload: rest.payload ?? {} });

/** Copy, thumbs, pick, delete: one event + an angle reward. */
export async function recordFeedback(userId: string, draftId: string, type: FeedbackType, payload: Record<string, unknown> = {}) {
  const d = await ownedDraft(userId, draftId);
  await logEvent(userId, d.voiceId, type, { draftId, batchId: d.batchId, payload });
  if (type === "delete") await db.update(t.drafts).set({ deletedAt: new Date() }).where(eq(t.drafts.id, draftId));
  await rewardAngle(d.voiceId, d.formula, type);
}

/** "Not these, try again": a weak negative for every draft in the batch. */
export async function recordRegenerate(userId: string, batchId: string) {
  const rows = await db
    .select({ id: t.drafts.id, voiceId: t.drafts.voiceId, formula: t.drafts.formula })
    .from(t.drafts)
    .innerJoin(t.voices, eq(t.voices.id, t.drafts.voiceId))
    .where(and(eq(t.drafts.batchId, batchId), eq(t.voices.userId, userId)));
  for (const r of rows) {
    await logEvent(userId, r.voiceId, "regenerate", { draftId: r.id, batchId });
    await rewardAngle(r.voiceId, r.formula, "regenerate");
  }
}

/** Blind A/B answer. Returns which arm each position was, for the reveal. */
export async function recordAbChoice(userId: string, batchId: string, choice: AbChoice) {
  const rows = await db
    .select({ arm: t.drafts.arm, idx: t.drafts.idx, voiceId: t.drafts.voiceId })
    .from(t.drafts)
    .innerJoin(t.voices, eq(t.voices.id, t.drafts.voiceId))
    .where(and(eq(t.drafts.batchId, batchId), eq(t.voices.userId, userId)));
  if (rows.length !== 2) throw new UserError("Comparison not found.");
  const arms = rows.sort((a, b) => a.idx - b.idx).map((r) => r.arm);
  const winner = choice === "a" ? arms[0] : choice === "b" ? arms[1] : choice;
  await logEvent(userId, rows[0].voiceId, "ab_choice", { batchId, payload: { choice, winner, arms } });
  return arms;
}

export async function allowCategory(userId: string, voiceId: string, category: string) {
  await ownedVoiceId(userId, voiceId);
  await db
    .update(t.voices)
    .set({ allowlist: sql`(SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(${t.voices.allowlist} || ${JSON.stringify([category])}::jsonb) x)` })
    .where(eq(t.voices.id, voiceId));
  await logEvent(userId, voiceId, "tell_override", { payload: { category } });
}

/* ---------- learning from edits ---------- */

const MiningOutput = z.object({
  hunks: z.array(z.object({ id: z.number().int(), type: z.enum(["style", "content", "typo"]) })),
  rules: z.array(
    z.object({
      kind: z.enum(RULE_KIND_IDS),
      phrase: z.string().nullable(),
      n: z.number().int().nullable(),
      note: z.string().nullable(),
      hunk_ids: z.array(z.number().int()),
    }),
  ),
});

const hunkLine = (h: Hunk) => `#${h.id} …${h.before} [removed: "${h.removed}"] [added: "${h.added}"] ${h.after}…`;

/** LLM proposes rules from style hunks; code keeps only proposals whose detector the edit actually proves. */
async function mineProposals(shown: string, kept: string, hunks: Hunk[], userId: string): Promise<{ proposal: Proposal; hunk: Hunk }[]> {
  const { data } = await structured("rules", MiningOutput, "edit_rules", {
    instructions: PROMPTS.rules.instructions,
    input: `SHOWN:\n${shown}\n\nKEPT:\n${kept}\n\nHUNKS:\n${hunks.map(hunkLine).join("\n")}`,
    userId,
  });
  const styleIds = new Set(data.hunks.filter((h) => h.type === "style").map((h) => h.id));
  const style = hunks.filter((h) => styleIds.has(h.id));
  return data.rules.slice(0, 2).flatMap((r) => {
    const params: RuleParams = Object.fromEntries(Object.entries({ phrase: r.phrase, n: r.n, note: r.note }).filter(([, v]) => v !== null));
    const proposal: Proposal = { kind: r.kind, params, hunkIds: r.hunk_ids };
    const hunk = style.find((h) => r.hunk_ids.includes(h.id));
    return verifyProposal(proposal, shown, kept, style) && hunk ? [{ proposal, hunk }] : [];
  });
}

export const toClientRule = (r: typeof t.rules.$inferSelect): ClientRule => ({
  id: r.id,
  kind: r.kind,
  params: r.params,
  text: r.text,
  status: r.status,
  evidenceCount: r.evidenceCount,
  evidence: r.evidence.map(({ removed, added }) => ({ removed, added })),
  source: r.source,
  archivedReason: r.archivedReason,
});

/** Saves the user's edit, then learns from it: contradictions first, then mined + verified rules. */
/** Fills one placeholder from the card. Not an edit: nothing is logged, rewarded or learned. */
export async function fillPlaceholder(userId: string, draftId: string, index: number, value: string) {
  const d = await ownedDraft(userId, draftId);
  const filled = withFilled(d.textKept ?? d.textShown, d.placeholderHints, index, value);
  if (!filled) throw new UserError("That placeholder isn't in the draft anymore.");
  await db.update(t.drafts).set({ textKept: filled.text, placeholderHints: filled.hints }).where(eq(t.drafts.id, draftId));
  return filled;
}

export async function saveEdit(userId: string, draftId: string, kept: string): Promise<LearnedReceipt> {
  const d = await ownedDraft(userId, draftId);
  const shown = d.textShown;
  const receipt: LearnedReceipt = { created: [], strengthened: [], contradicted: [] };
  kept = kept.normalize("NFC").trim();
  if (!kept || kept === (d.textKept ?? shown)) return receipt;
  const hunks = diffHunks(shown, kept);
  await db.update(t.drafts).set({ textKept: kept }).where(eq(t.drafts.id, draftId));
  if (!hunks.length) return receipt; // only placeholder fills (or whitespace): not an edit
  await logEvent(userId, d.voiceId, "edit", { draftId, batchId: d.batchId, payload: { burden: editBurden(shown, kept), hunks } });
  await rewardAngle(d.voiceId, d.formula, "edit");

  const existing = await db.select().from(t.rules).where(eq(t.rules.voiceId, d.voiceId));
  const write = async (rule: Rule, evidence?: { draftId: string; removed: string; added: string }) => {
    const prev = existing.find((e) => e.id === rule.id);
    const values = { ...rule, evidence: evidence ? [...(prev?.evidence ?? []), evidence] : (prev?.evidence ?? []), updatedAt: new Date() };
    const [row] = prev
      ? await db.update(t.rules).set(values).where(eq(t.rules.id, rule.id)).returning()
      : await db.insert(t.rules).values({ ...values, voiceId: d.voiceId, source: "edit" }).returning();
    return toClientRule(row);
  };

  for (const r of existing.map(toRule).filter((r) => contradictedBy(r, shown, kept))) receipt.contradicted.push(await write(withContradiction(r)));

  const live = existing.map(toRule).filter((r) => r.status !== "archived");
  for (const { proposal, hunk } of await mineProposals(shown, kept, hunks, userId)) {
    const evidence = { draftId, removed: hunk.removed, added: hunk.added };
    const match = live.find((r) => sameRule(r, proposal));
    if (match) receipt.strengthened.push(await write(withSupport(match, proposal.params), evidence));
    else {
      const rule: Rule = { id: randomUUID(), ...proposal, text: ruleText(proposal.kind, proposal.params), status: "candidate", evidenceCount: 1, contradictionCount: 0, archivedReason: null };
      receipt.created.push(await write(rule, evidence));
    }
  }
  if (receipt.created.length + receipt.strengthened.length + receipt.contradicted.length) await snapshot(d.voiceId, "learned from edit");
  return receipt;
}

/* ---------- rule management + versions ---------- */

async function snapshot(voiceId: string, reason: string) {
  const rows = await db.select().from(t.rules).where(eq(t.rules.voiceId, voiceId));
  const last = await db.query.rulesetVersions.findFirst({ where: eq(t.rulesetVersions.voiceId, voiceId), orderBy: desc(t.rulesetVersions.version) });
  const [v] = await db
    .insert(t.rulesetVersions)
    .values({ voiceId, version: (last?.version ?? 0) + 1, snapshot: snapshotOf(rows.map(toRule)), reason })
    .returning();
  await db.update(t.voices).set({ rulesetVersionId: v.id }).where(eq(t.voices.id, voiceId));
}

export type RuleAction = "confirm" | "archive" | "undo" | "restore";
const ACTION_STATUS = { confirm: "active", restore: "active", archive: "archived", undo: "archived" } as const;

export async function ruleAction(userId: string, ruleId: string, action: RuleAction) {
  const r = await ownedRule(userId, ruleId);
  const status = ACTION_STATUS[action];
  await db
    .update(t.rules)
    .set({ status, archivedReason: status === "archived" ? action : null, updatedAt: new Date() })
    .where(eq(t.rules.id, ruleId));
  await snapshot(r.voiceId, `${action}: ${r.text}`);
}

export async function updateRule(userId: string, ruleId: string, params: RuleParams) {
  const r = await ownedRule(userId, ruleId);
  const merged = { ...r.params, ...params };
  await db.update(t.rules).set({ params: merged, text: ruleText(r.kind, merged), updatedAt: new Date() }).where(eq(t.rules.id, ruleId));
  await snapshot(r.voiceId, `edited: ${ruleText(r.kind, merged)}`);
}

export async function addRule(userId: string, voiceId: string, kind: RuleKind, params: RuleParams) {
  await ownedVoiceId(userId, voiceId);
  const text = ruleText(kind, params);
  if (!text.trim()) throw new UserError("A rule needs some text.");
  await db.insert(t.rules).values({ voiceId, kind, params, text, status: "active", source: "manual" });
  await snapshot(voiceId, `added: ${text}`);
}

/** Restores an earlier ruleset: rules in the snapshot get their old state, every other live rule is archived. */
export async function restoreRuleset(userId: string, versionId: string) {
  const v = await db.query.rulesetVersions.findFirst({ where: eq(t.rulesetVersions.id, versionId) });
  if (!v) throw new UserError("Version not found.");
  await ownedVoiceId(userId, v.voiceId);
  const keep = new Map(v.snapshot.map((s) => [s.id, s]));
  const rows = await db.select().from(t.rules).where(eq(t.rules.voiceId, v.voiceId));
  for (const r of rows) {
    const s = keep.get(r.id);
    if (s) await db.update(t.rules).set({ status: s.status, params: s.params, text: s.text, archivedReason: null }).where(eq(t.rules.id, r.id));
    else if (r.status !== "archived") await db.update(t.rules).set({ status: "archived", archivedReason: "restore" }).where(eq(t.rules.id, r.id));
  }
  await snapshot(v.voiceId, `restored version ${v.version}`);
}
