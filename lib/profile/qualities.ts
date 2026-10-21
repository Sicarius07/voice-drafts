import { z } from "zod";
import { countOccurrences } from "@/lib/text";

// Field structure follows x-skills references/voice-profile.md (sections 1-3, 5) by Sergey Bulaev (MIT) @ ea61d1d.

const withIds = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, ids: z.array(z.string()) });

/** What the LLM returns. Posts are referenced by short ids (t1, t2...) so they can be checked. */
export const RawQualities = z.object({
  persona: z.string(),
  audience: z.string(),
  topics: z.array(withIds({ label: z.string() })),
  tone: z.array(withIds({ descriptor: z.string() })),
  phrases: z.array(z.string()),
  openers: z.array(z.string()),
  closers: z.array(z.string()),
  positions: z.array(withIds({ claim: z.string() })),
  never_uses: z.array(z.string()),
  signature_ids: z.array(z.string()),
});
export type RawQualities = z.infer<typeof RawQualities>;

export type Counted = { text: string; count: number };
export type Qualities = {
  persona: string;
  audience: string;
  topics: { label: string; count: number }[];
  tone: string[];
  phrases: Counted[];
  openers: Counted[];
  closers: Counted[];
  positions: string[];
  neverUses: string[];
  signatureIds: string[];
};

export type Verified = { qualities: Qualities; topicTags: Map<string, string[]>; dropped: number };

/**
 * Code verifies every claim the LLM made about the corpus: ids must exist, quoted phrases must occur
 * at least twice, "never uses" words must occur zero times. Unverifiable claims are dropped and counted.
 */
export function verifyQualities(raw: RawQualities, posts: { id: string; text: string }[]): Verified {
  const byShortId = new Map(posts.map((p, i) => [`t${i + 1}`, p]));
  const corpus = posts.map((p) => p.text);
  let dropped = 0;
  const keep = <T>(ok: boolean, value: T): T[] => (ok ? [value] : (dropped++, []));
  const realIds = (ids: string[]) => ids.map((id) => byShortId.get(id.trim())?.id).filter((x): x is string => !!x);

  const topicTags = new Map<string, string[]>();
  const topics = raw.topics.flatMap((t) => {
    const ids = [...new Set(realIds(t.ids))];
    if (ids.length >= 2) ids.forEach((id) => topicTags.set(id, [...(topicTags.get(id) ?? []), t.label]));
    return keep(ids.length >= 2, { label: t.label, count: ids.length });
  });
  const counted = (xs: string[]) =>
    xs.flatMap((text) => {
      const count = countOccurrences(corpus, text);
      return keep(count >= 2, { text, count });
    });
  const wordRe = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

  const qualities: Qualities = {
    persona: raw.persona,
    audience: raw.audience,
    topics,
    tone: raw.tone.flatMap((t) => keep(realIds(t.ids).length >= 1, t.descriptor)),
    phrases: counted(raw.phrases),
    openers: counted(raw.openers),
    closers: counted(raw.closers),
    positions: raw.positions.flatMap((p) => keep(realIds(p.ids).length >= 2, p.claim)),
    neverUses: raw.never_uses.flatMap((w) => keep(!corpus.some((t) => wordRe(w).test(t)), w)),
    signatureIds: realIds(raw.signature_ids).slice(0, 4),
  };
  return { qualities, topicTags, dropped };
}
