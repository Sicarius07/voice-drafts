import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePost, type ApiMedia, type ApiPost, type NormalizedPost } from "./normalize";

const BASE = "https://api.x.com/2";
/** Field parameter name per the current OpenAPI spec (v2.172); verified on the first real call. */
const FIELDS_PARAM = "post.fields";
const POST_FIELDS = "created_at,public_metrics,entities,lang,note_post,attachments,conversation_id";
const MEDIA_FIELDS = "type,url,preview_image_url,alt_text,width,height";
export const X_COST = { post: 0.005, user: 0.01 };

export type XErrorKind = "not_found" | "protected" | "rate_limited" | "credits" | "unavailable";
export class XApiError extends Error {
  constructor(
    public kind: XErrorKind,
    message: string,
  ) {
    super(message);
  }
}

type Problem = { type?: string; title?: string; detail?: string };
type Body = { data?: unknown; errors?: Problem[]; includes?: { media?: ApiMedia[] }; meta?: { next_token?: string; result_count?: number }; title?: string; detail?: string };

function classify(status: number, body: Body): XApiError {
  const msg = body.detail ?? body.title ?? body.errors?.[0]?.detail ?? `X API error ${status}`;
  if (status === 429) return new XApiError("rate_limited", "X API rate limit reached. Try again in a few minutes.");
  if (status === 402 || /credit|payment|billing|balance/i.test(msg)) return new XApiError("credits", msg);
  if (status >= 500) return new XApiError("unavailable", msg);
  const problem = body.errors?.[0]?.type ?? "";
  if (/resource-not-found/.test(problem) || status === 404) return new XApiError("not_found", "That handle doesn't exist or is suspended.");
  if (/not-authorized-for-resource/.test(problem)) return new XApiError("protected", "That account is protected.");
  return new XApiError("unavailable", msg);
}

/** Local-dev only: raw responses cached on disk so re-runs don't spend credits. Unset on Vercel. */
const cacheFile = (url: string) => {
  const dir = process.env.X_RAW_CACHE_DIR;
  return dir ? path.join(dir, `${createHash("sha1").update(url).digest("hex")}.json`) : null;
};

async function xGet(endpoint: string, params: Record<string, string>): Promise<Body> {
  const url = `${BASE}${endpoint}?${new URLSearchParams(params)}`;
  const file = cacheFile(url);
  if (file) {
    const hit = await readFile(file, "utf8").catch(() => null);
    if (hit) return JSON.parse(hit);
  }
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new XApiError("unavailable", "X_BEARER_TOKEN is not set.");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
    const body: Body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && !(body.errors?.length && !body.data)) {
      if (file) await mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, JSON.stringify(body)));
      return body;
    }
    const err = res ? classify(res.status, body) : new XApiError("unavailable", "Couldn't reach the X API.");
    if (err.kind !== "unavailable" || attempt >= 1) throw err;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export type XUser = { id: string; username: string; name: string; description: string; profile_image_url?: string; protected?: boolean };

export async function lookupUser(username: string): Promise<XUser> {
  const body = await xGet(`/users/by/username/${encodeURIComponent(username)}`, {
    "user.fields": "id,name,username,description,profile_image_url,protected,public_metrics,verified_type",
  });
  const user = body.data as XUser;
  if (user.protected) throw new XApiError("protected", "That account is protected.");
  return user;
}

/** Original posts only (no replies, no retweets), up to `maxPages` pages of 100. */
export async function fetchPosts(userId: string, opts: { sinceId?: string | null; maxPages?: number } = {}): Promise<{ posts: NormalizedPost[]; read: number }> {
  const posts: NormalizedPost[] = [];
  let read = 0;
  let next: string | undefined;
  for (let page = 0; page < (opts.maxPages ?? 2); page++) {
    const body = await xGet(`/users/${userId}/tweets`, {
      max_results: "100",
      exclude: "replies,retweets",
      [FIELDS_PARAM]: POST_FIELDS,
      expansions: "attachments.media_keys",
      "media.fields": MEDIA_FIELDS,
      ...(opts.sinceId ? { since_id: opts.sinceId } : {}),
      ...(next ? { pagination_token: next } : {}),
    });
    const data = (body.data as ApiPost[] | undefined) ?? [];
    const media = new Map((body.includes?.media ?? []).map((m) => [m.media_key, m]));
    posts.push(...data.map((p) => normalizePost(p, media)));
    read += data.length;
    next = body.meta?.next_token;
    if (!next) break;
  }
  return { posts, read };
}

export const xCost = (postsRead: number, lookups = 1) => postsRead * X_COST.post + lookups * X_COST.user;
