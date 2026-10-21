import type { Metrics } from "@/lib/generate/examples";
import { weightedLength } from "@/lib/text";

type UrlEntity = { url?: string | null; expanded_url?: string | null; display_url?: string | null; media_key?: string | null };
export type ApiPost = {
  id: string;
  text: string;
  created_at?: string;
  lang?: string;
  public_metrics?: Metrics;
  entities?: { urls?: UrlEntity[] | null };
  note_post?: { text: string; entities?: { urls?: UrlEntity[] | null } };
  attachments?: { media_keys?: string[] };
  referenced_posts?: { type: string; id: string }[];
  referenced_tweets?: { type: string; id: string }[];
};
export type ApiMedia = {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
};
export type MediaMeta = { type: string; url: string | null; altText: string | null; width: number | null; height: number | null };
/** The post exactly as the API returned it, with its media objects: enough to re-run normalization without refetching. */
export type RawPost = { post: ApiPost; media: ApiMedia[] };

export type NormalizedPost = {
  id: string;
  text: string;
  kind: "original" | "quote";
  postedAt: Date | null;
  lang: string | null;
  metrics: Metrics | null;
  isLongPost: boolean;
  mediaDependent: boolean;
  media: MediaMeta[];
  raw: RawPost | null;
};

/** Decodes the HTML entities the X API leaves in post text (&amp; last, so "&amp;lt;" stays "&lt;"). */
export const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const STATUS_LINK = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/\d+/i;
const MEDIA_LINK = /\/(?:photo|video)\/\d+$/;

/**
 * Turns an API post into what the person actually typed: full text for long posts, media and quote
 * links removed, other t.co links expanded. Entity indices are not used (they count code points).
 */
export function normalizePost(p: ApiPost, mediaByKey: Map<string, ApiMedia>): NormalizedPost {
  const src = p.note_post ?? p;
  const urls = src.entities?.urls ?? p.entities?.urls ?? [];
  const refs = p.referenced_posts ?? p.referenced_tweets ?? [];
  let quote = refs.some((r) => r.type === "quoted");
  let text = src.text;
  for (const u of urls) {
    if (!u.url) continue;
    const expanded = u.expanded_url ?? u.display_url ?? "";
    const isQuoteLink = STATUS_LINK.test(expanded) && !u.media_key && !MEDIA_LINK.test(expanded);
    quote ||= isQuoteLink && text.trimEnd().endsWith(u.url);
    const replacement = u.media_key || MEDIA_LINK.test(expanded) || isQuoteLink ? "" : expanded;
    text = text.split(u.url).join(replacement);
  }
  text = decodeEntities(text).replace(/[ \t]+\n/g, "\n").trim();
  const apiMedia = (p.attachments?.media_keys ?? []).map((k) => mediaByKey.get(k)).filter((m): m is ApiMedia => !!m);
  const media = apiMedia.map((m) => ({ type: m.type, url: m.url ?? m.preview_image_url ?? null, altText: m.alt_text ?? null, width: m.width ?? null, height: m.height ?? null }));
  return {
    id: p.id,
    text,
    kind: quote ? "quote" : "original",
    postedAt: p.created_at ? new Date(p.created_at) : null,
    lang: p.lang ?? null,
    metrics: p.public_metrics ?? null,
    isLongPost: !!p.note_post,
    mediaDependent: media.length > 0 && weightedLength(text) < 40,
    media,
    raw: { post: p, media: apiMedia },
  };
}

/** Keeps posts in the dominant language with some text left after normalization. */
export function usablePosts(posts: NormalizedPost[]): NormalizedPost[] {
  const langs = new Map<string, number>();
  posts.forEach((p) => p.lang && langs.set(p.lang, (langs.get(p.lang) ?? 0) + 1));
  const main = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0];
  return posts.filter((p) => p.text.length > 0 && (!main || !p.lang || p.lang === main || p.lang === "zxx" || p.lang === "und"));
}
