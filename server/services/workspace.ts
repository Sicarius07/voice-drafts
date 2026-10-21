import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { FORMULA_IDS, FORMULAS } from "@/lib/angles";
import { posteriorMean, PRIOR } from "@/lib/learning/bandit";
import { abTally, qualitySeries } from "@/lib/learning/metrics";
import { ACCEPT_TYPES } from "@/lib/learning/signals";
import type { AbChoice, ClientBatch, ClientDraft, DraftArm, DraftState } from "@/lib/types";
import { db, t } from "@/server/db";
import { loadVoiceCtx, type VoiceCtx } from "./context";
import { loadPosteriors, toClientRule } from "./learning";

type DraftRow = typeof t.drafts.$inferSelect;
const STALE_MS = 7 * 24 * 3600 * 1000;
const NO_STATE: DraftState = { thumbs: null, copied: false, picked: false };
type AbPayload = { choice: AbChoice; winner: string; arms: DraftArm[] };

/** Shapes a stored draft for the UI. Unanswered A/B drafts hide their arm and the rules they used. */
export function toClientDraft(row: DraftRow, ctx: Pick<VoiceCtx, "rules" | "byId">, state: DraftState = NO_STATE, blind = false): ClientDraft {
  const ruleText = new Map(ctx.rules.map((r) => [r.id, r.text]));
  return {
    id: row.id,
    batchId: row.batchId,
    idx: row.idx,
    arm: blind ? "normal" : row.arm,
    formula: row.formula,
    angle: FORMULAS[row.formula].name,
    text: row.textShown,
    kept: row.textKept,
    tells: row.tells,
    voiceMatch: row.voiceMatch,
    warnings: row.validation.warnings,
    humanizedFrom: row.humanize?.before ?? null,
    why: {
      rules: blind ? [] : row.ruleIds.map((id) => ruleText.get(id) ?? "(rule since deleted)"),
      examples: row.exampleIds.map((id) => ctx.byId.get(id)?.text ?? "").filter(Boolean),
      promptVersion: row.promptVersion,
      model: row.model,
    },
    state,
  };
}

export async function loadWorkspace(voiceId: string, userId: string) {
  const ctx = await loadVoiceCtx(voiceId, userId, "read");
  const [batchRows, allBatches, versions, posteriors, events, allDrafts] = await Promise.all([
    db.select().from(t.batches).where(eq(t.batches.voiceId, voiceId)).orderBy(desc(t.batches.createdAt)).limit(20),
    db.select({ id: t.batches.id, kind: t.batches.kind }).from(t.batches).where(eq(t.batches.voiceId, voiceId)).orderBy(asc(t.batches.createdAt)),
    db.select().from(t.rulesetVersions).where(eq(t.rulesetVersions.voiceId, voiceId)).orderBy(desc(t.rulesetVersions.version)).limit(20),
    loadPosteriors(voiceId),
    db.select().from(t.feedbackEvents).where(eq(t.feedbackEvents.voiceId, voiceId)).orderBy(asc(t.feedbackEvents.createdAt)),
    db.select({ id: t.drafts.id, batchId: t.drafts.batchId }).from(t.drafts).where(eq(t.drafts.voiceId, voiceId)),
  ]);
  const ids = batchRows.map((b) => b.id);
  const draftRows = ids.length
    ? await db.select().from(t.drafts).where(and(inArray(t.drafts.batchId, ids), isNull(t.drafts.deletedAt))).orderBy(asc(t.drafts.idx))
    : [];

  const state = new Map<string, DraftState>();
  const abByBatch = new Map<string, AbPayload>();
  for (const e of events) {
    if (e.type === "ab_choice" && e.batchId) abByBatch.set(e.batchId, e.payload as AbPayload);
    if (!e.draftId) continue;
    const s = { ...(state.get(e.draftId) ?? NO_STATE) };
    if (e.type === "thumbs_up" || e.type === "thumbs_down") s.thumbs = e.type === "thumbs_up" ? "up" : "down";
    if (e.type === "copy") s.copied = true;
    if (e.type === "pick") s.picked = true;
    state.set(e.draftId, s);
  }

  const batches: ClientBatch[] = batchRows.map((b) => {
    const ab = abByBatch.get(b.id) ?? null;
    const blind = b.kind === "ab" && !ab;
    return {
      id: b.id,
      kind: b.kind,
      goal: b.goal,
      topic: b.topic,
      notes: b.notes,
      createdAt: b.createdAt.toISOString(),
      drafts: draftRows.filter((d) => d.batchId === b.id).map((d) => toClientDraft(d, ctx, state.get(d.id), blind)),
      ab: ab && { choice: ab.choice, arms: ab.arms },
    };
  });

  // Quality over time: normal batches only, oldest first. Burden covers drafts you used (edited, or accepted as-is = 0).
  const accepted = new Set(events.filter((e) => ACCEPT_TYPES.includes(e.type) && e.draftId).map((e) => e.draftId!));
  const burdenByDraft = new Map(events.filter((e) => e.type === "edit" && e.draftId).map((e) => [e.draftId!, (e.payload as { burden: number }).burden]));
  const series = qualitySeries(
    allBatches.filter((b) => b.kind === "normal").map(({ id: bid }) => {
      const ds = allDrafts.filter((d) => d.batchId === bid);
      return { shown: ds.length, accepted: ds.filter((d) => accepted.has(d.id)).length, burdens: ds.flatMap((d) => burdenByDraft.get(d.id) ?? (accepted.has(d.id) ? 0 : [])) };
    }),
  );

  const ruleRows = await db.select().from(t.rules).where(eq(t.rules.voiceId, voiceId)).orderBy(desc(t.rules.updatedAt));
  return {
    voice: { id: ctx.voice.id, readOnly: ctx.readOnly, isShowcase: ctx.voice.isShowcase, allowlist: ctx.voice.allowlist },
    account: { username: ctx.account.username, name: ctx.account.name, avatarUrl: ctx.account.avatarUrl, bio: ctx.account.bio, isDemo: ctx.account.isDemo, fetchedAt: ctx.account.fetchedAt?.toISOString() ?? null, fromApi: !!ctx.account.xUserId, stale: !!ctx.account.fetchedAt && Date.now() - ctx.account.fetchedAt.getTime() > STALE_MS },
    profile: {
      version: ctx.profile.version,
      createdAt: ctx.profile.createdAt.toISOString(),
      stats: ctx.profile.stats,
      qualities: ctx.profile.qualities,
      signatures: ctx.signatures,
      droppedClaims: ctx.profile.droppedClaims,
      fromPaste: !!ctx.profile.ownerUserId,
    },
    rules: ruleRows.map(toClientRule),
    versions: versions.map((v) => ({ id: v.id, version: v.version, reason: v.reason, createdAt: v.createdAt.toISOString(), current: v.id === ctx.voice.rulesetVersionId })),
    angles: FORMULA_IDS.map((f) => {
      const p = posteriors[f] ?? PRIOR;
      return { formula: f, name: FORMULAS[f].name, mean: posteriorMean(p), n: Math.round(p.alpha + p.beta - 2) };
    }),
    batches,
    series,
    ab: abTally([...abByBatch.values()].map((a) => a.winner)),
  };
}

export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

/** The voices home: the user's voices, demo handles, and the read-only simulated showcase (if seeded). */
export async function loadVoicesPage(userId: string) {
  const [mine, demos, showcase] = await Promise.all([
    db
      .select({ id: t.voices.id, username: t.xAccounts.username, name: t.xAccounts.name, avatarUrl: t.xAccounts.avatarUrl, stats: t.voiceProfiles.stats, isDemo: t.xAccounts.isDemo })
      .from(t.voices)
      .innerJoin(t.xAccounts, eq(t.xAccounts.id, t.voices.xAccountId))
      .innerJoin(t.voiceProfiles, eq(t.voiceProfiles.id, t.voices.profileId))
      .where(eq(t.voices.userId, userId))
      .orderBy(desc(t.voices.createdAt)),
    db.select({ username: t.xAccounts.username, name: t.xAccounts.name }).from(t.xAccounts).where(eq(t.xAccounts.isDemo, true)),
    db.query.voices.findFirst({ where: eq(t.voices.isShowcase, true) }),
  ]);
  return {
    voices: mine.map(({ stats, ...v }) => ({ ...v, confidence: stats.confidence, posts: stats.n })),
    demos,
    showcaseId: showcase?.id ?? null,
  };
}
