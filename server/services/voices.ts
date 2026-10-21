import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { engagementPercentiles } from "@/lib/generate/examples";
import { RawQualities, verifyQualities } from "@/lib/profile/qualities";
import { computeStats } from "@/lib/profile/stats";
import { MIN_PASTED, splitPasted, untrusted } from "@/lib/text";
import { db, t } from "@/server/db";
import { MODEL, structured } from "@/server/llm/client";
import { PROMPTS } from "@/server/llm/prompts";
import { fetchPosts, lookupUser, xCost } from "@/server/x/client";
import { usablePosts, type NormalizedPost } from "@/server/x/normalize";
import { corpusFor, UserError } from "./context";

export type Send = (event: Record<string, unknown>) => void;
const progress = (send: Send, step: string) => send({ type: "progress", step });

export function normalizeHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").split(/[/?]/)[0].toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(h)) throw new UserError("That doesn't look like an X handle.");
  return h;
}

/** Inserts or refreshes posts (and everyone's engagement percentiles) in one statement. */
async function storePosts(xAccountId: string, posts: NormalizedPost[], ownerUserId: string | null) {
  if (!posts.length) return;
  const existing = await db
    .select({ id: t.tweets.id, metrics: t.tweets.metrics, postedAt: t.tweets.postedAt })
    .from(t.tweets)
    .where(and(eq(t.tweets.xAccountId, xAccountId), ownerUserId ? eq(t.tweets.ownerUserId, ownerUserId) : isNull(t.tweets.ownerUserId)));
  const engagement = engagementPercentiles([...existing.filter((e) => !posts.some((p) => p.id === e.id)), ...posts]);
  await db
    .insert(t.tweets)
    .values(posts.map((p) => ({ ...p, xAccountId, ownerUserId, engagement: engagement.get(p.id) ?? null, source: ownerUserId ? ("paste" as const) : ("x" as const) })))
    .onConflictDoUpdate({
      target: t.tweets.id,
      set: { text: sql`excluded.text`, metrics: sql`excluded.metrics`, engagement: sql`excluded.engagement`, raw: sql`excluded.raw` },
    });
}

/** Fetches a handle from the X API once (shared by all users). Costs ~$1.01 for 200 posts. */
async function fetchAccount(username: string, send: Send, refresh = false) {
  let account = await db.query.xAccounts.findFirst({ where: eq(t.xAccounts.username, username) });
  if (account?.fetchedAt && !refresh) return account;
  progress(send, `Looking up @${username}`);
  if (!account?.xUserId) {
    const u = await lookupUser(username);
    [account] = await db
      .insert(t.xAccounts)
      .values({ xUserId: u.id, username, name: u.name, bio: u.description ?? "", avatarUrl: u.profile_image_url?.replace("_normal", "_200x200") ?? null })
      .onConflictDoUpdate({ target: t.xAccounts.username, set: { xUserId: u.id, name: u.name, bio: u.description ?? "" } })
      .returning();
  }
  const [locked] = await db
    .update(t.xAccounts)
    .set({ fetchStatus: "fetching" })
    .where(and(eq(t.xAccounts.id, account.id), ne(t.xAccounts.fetchStatus, "fetching")))
    .returning();
  if (!locked) throw new UserError("Someone is fetching this handle right now. Try again in a minute.");
  try {
    progress(send, "Fetching original posts");
    const { posts, read } = await fetchPosts(account.xUserId!, { sinceId: refresh ? account.newestPostId : null, maxPages: refresh ? 1 : 2 });
    const usable = usablePosts(posts);
    await storePosts(account.id, usable, null);
    progress(send, `Fetched ${read} posts (≈$${xCost(read).toFixed(2)} of X credits)`);
    const newest = posts.map((p) => p.id).sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1))[0];
    [account] = await db
      .update(t.xAccounts)
      .set({ fetchedAt: new Date(), newestPostId: newest ?? account.newestPostId, postsRead: sql`${t.xAccounts.postsRead} + ${read}` })
      .where(eq(t.xAccounts.id, account.id))
      .returning();
    return account;
  } finally {
    await db.update(t.xAccounts).set({ fetchStatus: "idle" }).where(eq(t.xAccounts.id, account.id));
  }
}

/** Stats (code) + qualities (LLM, then verified by code) → a new immutable profile version. */
export async function buildProfile(xAccountId: string, ownerUserId: string | null, userId: string, send: Send) {
  const posts = await corpusFor(xAccountId, ownerUserId);
  if (posts.length < 10) throw new UserError(`Only ${posts.length} usable posts found; need at least 10. Try pasting more.`);
  progress(send, "Measuring style");
  const stats = computeStats(posts);
  progress(send, "Reading your voice");
  const { data, usage } = await structured("profile", RawQualities, "voice_profile", {
    instructions: PROMPTS.profile.instructions,
    input: untrusted("posts", posts.map((p, i) => ({ id: `t${i + 1}`, text: p.text }))),
    userId,
  });
  const { qualities, topicTags, dropped } = verifyQualities(data, posts);
  const tags = Object.fromEntries(posts.map((p) => [p.id, topicTags.get(p.id) ?? []]));
  await db.execute(sql`
    UPDATE tweets SET topic_tags = ARRAY(SELECT jsonb_array_elements_text(v.value))
    FROM jsonb_each(${JSON.stringify(tags)}::jsonb) v WHERE tweets.id = v.key`);
  const last = await db.query.voiceProfiles.findFirst({
    where: and(eq(t.voiceProfiles.xAccountId, xAccountId), ownerUserId ? eq(t.voiceProfiles.ownerUserId, ownerUserId) : isNull(t.voiceProfiles.ownerUserId)),
    orderBy: desc(t.voiceProfiles.version),
  });
  const [profile] = await db
    .insert(t.voiceProfiles)
    .values({
      xAccountId,
      ownerUserId,
      version: (last?.version ?? 0) + 1,
      stats,
      qualities,
      droppedClaims: dropped,
      tweetCount: posts.length,
      promptVersion: PROMPTS.profile.version,
      model: MODEL,
    })
    .returning();
  progress(send, `Profile built (${dropped} unverifiable claims dropped, $${usage.costUsd.toFixed(3)})`);
  return profile;
}

const latestSharedProfile = (xAccountId: string) =>
  db.query.voiceProfiles.findFirst({
    where: and(eq(t.voiceProfiles.xAccountId, xAccountId), isNull(t.voiceProfiles.ownerUserId)),
    orderBy: desc(t.voiceProfiles.version),
  });

async function upsertVoice(userId: string, xAccountId: string, profileId: string) {
  const [voice] = await db
    .insert(t.voices)
    .values({ userId, xAccountId, profileId })
    .onConflictDoUpdate({ target: [t.voices.userId, t.voices.xAccountId], set: { profileId } })
    .returning();
  return voice.id;
}

export async function createVoice(userId: string, input: { handle: string; pasted?: string }, send: Send): Promise<string> {
  const username = normalizeHandle(input.handle);
  if (input.pasted !== undefined) {
    const texts = splitPasted(input.pasted);
    if (texts.length < MIN_PASTED) throw new UserError(`Found ${texts.length} posts; paste at least ${MIN_PASTED}, separated by blank lines.`);
    const [account] = await db
      .insert(t.xAccounts)
      .values({ username, name: username })
      .onConflictDoUpdate({ target: t.xAccounts.username, set: { username } })
      .returning();
    await db.delete(t.tweets).where(and(eq(t.tweets.xAccountId, account.id), eq(t.tweets.ownerUserId, userId)));
    await storePosts(
      account.id,
      texts.map((text) => ({ id: `paste_${randomUUID()}`, text, kind: "original", postedAt: null, lang: null, metrics: null, isLongPost: false, mediaDependent: false, media: [], raw: null })),
      userId,
    );
    const profile = await buildProfile(account.id, userId, userId, send);
    return upsertVoice(userId, account.id, profile.id);
  }
  const { account, profile } = await ensureSharedProfile(username, userId, send);
  return upsertVoice(userId, account.id, profile.id);
}

/** Fetches a handle once (shared cache) and makes sure it has a shared profile. Used by createVoice and the demo seed. */
export async function ensureSharedProfile(username: string, userId: string, send: Send) {
  const account = await fetchAccount(username, send);
  const profile = (await latestSharedProfile(account.id)) ?? (await buildProfile(account.id, null, userId, send));
  return { account, profile };
}

/** Pulls new posts since the last fetch (≤ 1 page), rebuilds the shared profile, moves every voice on it. */
export async function refreshVoice(userId: string, voiceId: string, send: Send) {
  const voice = await db.query.voices.findFirst({ where: and(eq(t.voices.id, voiceId), eq(t.voices.userId, userId)) });
  if (!voice) throw new UserError("Voice not found.");
  const account = await db.query.xAccounts.findFirst({ where: eq(t.xAccounts.id, voice.xAccountId) });
  if (!account?.xUserId) throw new UserError("This voice was built from pasted posts; paste again to update it.");
  if (account.isDemo) throw new UserError("Demo voices stay as seeded.");
  const fetched = await fetchAccount(account.username, send, true);
  if (fetched.newestPostId === account.newestPostId) return progress(send, "No new posts since the last fetch.");
  const profile = await buildProfile(account.id, null, userId, send);
  const shared = db.select({ id: t.voiceProfiles.id }).from(t.voiceProfiles).where(isNull(t.voiceProfiles.ownerUserId));
  await db
    .update(t.voices)
    .set({ profileId: profile.id })
    .where(and(eq(t.voices.xAccountId, account.id), inArray(t.voices.profileId, shared)));
}
