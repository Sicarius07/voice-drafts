import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ExamplePost } from "@/lib/generate/examples";
import type { Rule } from "@/lib/learning/rules";
import { voiceCard } from "@/lib/profile/voice-card";
import { typicalityDistribution } from "@/lib/profile/voice-match";
import { db, t } from "@/server/db";

/** A message safe to show the user as-is. */
export class UserError extends Error {}

export type CorpusPost = ExamplePost & { postedAt: Date | null; kind: "original" | "quote" };
export type VoiceCtx = Awaited<ReturnType<typeof loadVoiceCtx>>;

/** Posts a profile is built from: shared API posts, or the user's own pasted posts. */
export async function corpusFor(xAccountId: string, ownerUserId: string | null): Promise<CorpusPost[]> {
  const rows = await db
    .select()
    .from(t.tweets)
    .where(and(eq(t.tweets.xAccountId, xAccountId), ownerUserId ? eq(t.tweets.ownerUserId, ownerUserId) : isNull(t.tweets.ownerUserId)))
    .orderBy(asc(t.tweets.postedAt));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    kind: r.kind,
    postedAt: r.postedAt,
    topicTags: r.topicTags,
    engagement: r.engagement,
    mediaDependent: r.mediaDependent,
  }));
}

export const toRule = (r: typeof t.rules.$inferSelect): Rule => ({
  id: r.id,
  kind: r.kind,
  params: r.params,
  text: r.text,
  status: r.status,
  evidenceCount: r.evidenceCount,
  contradictionCount: r.contradictionCount,
  archivedReason: r.archivedReason,
  updatedAt: r.updatedAt,
});

export type ProfileRow = typeof t.voiceProfiles.$inferSelect;

/** A profile plus what's derived from its corpus: posts, signature texts, voice card, voice-match reference. */
export async function loadProfileCtx(profile: ProfileRow) {
  const corpus = await corpusFor(profile.xAccountId, profile.ownerUserId);
  const byId = new Map(corpus.map((p) => [p.id, p]));
  const signatures = profile.qualities.signatureIds.map((id) => byId.get(id)?.text).filter((x): x is string => !!x);
  return {
    profile,
    corpus,
    signatures,
    card: voiceCard(profile.stats, profile.qualities, signatures),
    /** Reference distribution for voice match: computed on load (cheap), so it never goes stale. */
    typicality: typicalityDistribution(corpus.map((p) => p.text), profile.stats),
  };
}
export type ProfileCtx = Awaited<ReturnType<typeof loadProfileCtx>>;

/**
 * Everything a request needs about one voice. Read access: the owner, or anyone for showcase voices.
 * Write access: the owner only.
 */
export async function loadVoiceCtx(voiceId: string, userId: string, access: "read" | "write" = "write") {
  const voice = await db.query.voices.findFirst({ where: eq(t.voices.id, voiceId) });
  if (!voice || (voice.userId !== userId && !(access === "read" && voice.isShowcase))) throw new UserError("Voice not found.");
  const [account, profile, ruleRows] = await Promise.all([
    db.query.xAccounts.findFirst({ where: eq(t.xAccounts.id, voice.xAccountId) }),
    db.query.voiceProfiles.findFirst({ where: eq(t.voiceProfiles.id, voice.profileId) }),
    db.select().from(t.rules).where(eq(t.rules.voiceId, voiceId)).orderBy(asc(t.rules.createdAt)),
  ]);
  if (!account || !profile) throw new UserError("Voice not found.");
  return { ...(await loadProfileCtx(profile)), voice, account, rules: ruleRows.map(toRule), readOnly: voice.userId !== userId };
}
