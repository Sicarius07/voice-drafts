import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { FormulaId, Goal } from "@/lib/angles";
import type { Engagement, Metrics } from "@/lib/generate/examples";
import type { PlaceholderHint } from "@/lib/generate/placeholders";
import type { Issue } from "@/lib/generate/validate";
import type { Tell } from "@/lib/judge/tells";
import type { RuleKind, RuleParams, RuleStatus, Snapshot } from "@/lib/learning/rules";
import type { FeedbackType } from "@/lib/learning/signals";
import type { Qualities } from "@/lib/profile/qualities";
import type { Stats } from "@/lib/profile/stats";
import type { VoiceMatch } from "@/lib/profile/voice-match";
import type { DraftArm } from "@/lib/types";
import type { MediaMeta, RawPost } from "@/server/x/normalize";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ---------- Better Auth core tables ---------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------- X data (shared cache: fetched once per handle for everyone) ---------- */

export const xAccounts = pgTable("x_accounts", {
  id: id(),
  xUserId: text("x_user_id").unique(),
  username: text("username").notNull().unique(), // lowercase
  name: text("name").notNull(),
  bio: text("bio").notNull().default(""),
  avatarUrl: text("avatar_url"),
  isDemo: boolean("is_demo").notNull().default(false),
  newestPostId: text("newest_post_id"),
  postsRead: integer("posts_read").notNull().default(0),
  fetchStatus: text("fetch_status").$type<"idle" | "fetching">().notNull().default("idle"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const tweets = pgTable(
  "tweets",
  {
    id: text("id").primaryKey(),
    xAccountId: uuid("x_account_id").notNull().references(() => xAccounts.id, { onDelete: "cascade" }),
    /** null = fetched from the API (shared); set = pasted by this user (private). */
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: text("kind").$type<"original" | "quote">().notNull(),
    isLongPost: boolean("is_long_post").notNull().default(false),
    mediaDependent: boolean("media_dependent").notNull().default(false),
    media: jsonb("media").$type<MediaMeta[]>().notNull().default([]),
    lang: text("lang"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    metrics: jsonb("metrics").$type<Metrics | null>(),
    engagement: jsonb("engagement").$type<Engagement | null>(),
    topicTags: text("topic_tags").array().notNull().default(sql`'{}'::text[]`),
    source: text("source").$type<"x" | "paste">().notNull(),
    /** API posts only: the raw response for this post, so normalization can be re-run without refetching. */
    raw: jsonb("raw").$type<RawPost | null>(),
  },
  (t) => [index("tweets_account_idx").on(t.xAccountId, t.postedAt)],
);

export const voiceProfiles = pgTable("voice_profiles", {
  id: id(),
  xAccountId: uuid("x_account_id").notNull().references(() => xAccounts.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  stats: jsonb("stats").$type<Stats>().notNull(),
  qualities: jsonb("qualities").$type<Qualities>().notNull(),
  droppedClaims: integer("dropped_claims").notNull().default(0),
  tweetCount: integer("tweet_count").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

/* ---------- Per-user learning workspace (user × handle) ---------- */

export const voices = pgTable(
  "voices",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    xAccountId: uuid("x_account_id").notNull().references(() => xAccounts.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => voiceProfiles.id),
    rulesetVersionId: uuid("ruleset_version_id"),
    /** Tell categories the user marked "fine for them". */
    allowlist: jsonb("allowlist").$type<string[]>().notNull().default([]),
    isShowcase: boolean("is_showcase").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.xAccountId)],
);

export const rules = pgTable("rules", {
  id: id(),
  voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
  kind: text("kind").$type<RuleKind>().notNull(),
  params: jsonb("params").$type<RuleParams>().notNull(),
  text: text("text").notNull(),
  status: text("status").$type<RuleStatus>().notNull(),
  evidenceCount: integer("evidence_count").notNull().default(1),
  contradictionCount: integer("contradiction_count").notNull().default(0),
  evidence: jsonb("evidence").$type<{ draftId: string; removed: string; added: string }[]>().notNull().default([]),
  source: text("source").$type<"edit" | "manual">().notNull(),
  archivedReason: text("archived_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rulesetVersions = pgTable("ruleset_versions", {
  id: id(),
  voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Snapshot>().notNull(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const angleStats = pgTable(
  "angle_stats",
  {
    voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
    formula: text("formula").$type<FormulaId>().notNull(),
    alpha: real("alpha").notNull().default(1),
    beta: real("beta").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.voiceId, t.formula] })],
);

export const batches = pgTable("batches", {
  id: id(),
  voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  goal: text("goal").$type<Goal | "any">().notNull(),
  topic: text("topic"),
  notes: text("notes").notNull().default(""),
  kind: text("kind").$type<"normal" | "ab">().notNull(),
  createdAt: createdAt(),
});

export const drafts = pgTable(
  "drafts",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => batches.id, { onDelete: "cascade" }),
    voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    arm: text("arm").$type<DraftArm>().notNull(),
    formula: text("formula").$type<FormulaId>().notNull(),
    textRaw: text("text_raw").notNull(),
    textShown: text("text_shown").notNull(),
    textHumanized: text("text_humanized"),
    textKept: text("text_kept"),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    promptVersion: text("prompt_version").notNull(),
    judgeVersion: text("judge_version").notNull(),
    profileId: uuid("profile_id").notNull().references(() => voiceProfiles.id),
    rulesetVersionId: uuid("ruleset_version_id"),
    exampleIds: text("example_ids").array().notNull(),
    ruleIds: text("rule_ids").array().notNull(),
    validation: jsonb("validation").$type<{ errors: Issue[]; warnings: Issue[]; repaired: boolean }>().notNull(),
    tells: jsonb("tells").$type<Tell[]>().notNull(),
    voiceMatch: jsonb("voice_match").$type<VoiceMatch>().notNull(),
    /** Set when the humanizer rewrote the draft: the original text, which `tells` describe. */
    humanize: jsonb("humanize").$type<{ before: string } | null>(),
    placeholderHints: jsonb("placeholder_hints").$type<PlaceholderHint[]>().notNull().default([]),
    usage: jsonb("usage").$type<{ input: number; cached: number; output: number; reasoning: number; costUsd: number }>().notNull(),
    prompt: text("prompt").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("drafts_voice_idx").on(t.voiceId, t.createdAt)],
);

export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    voiceId: uuid("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    type: text("type").$type<FeedbackType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_voice_idx").on(t.voiceId, t.createdAt)],
);
