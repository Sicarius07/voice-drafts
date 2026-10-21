import "server-only";
import { z } from "zod";
import { cleanup } from "@/lib/generate/validate";
import { LLM_CATEGORIES, labelOf } from "@/lib/judge/catalog";
import { applyAllowlist, capsFrom, detectCodeTells, verifySpans, type Tell } from "@/lib/judge/tells";
import { habits, type Stats } from "@/lib/profile/stats";
import { voiceMatch, type VoiceMatch } from "@/lib/profile/voice-match";
import { untrusted } from "@/lib/text";
import { streamText, structured, type Usage } from "@/server/llm/client";
import { PROMPTS } from "@/server/llm/prompts";

const JudgeOutput = z.object({
  flags: z.array(
    z.object({
      category: z.enum(LLM_CATEGORIES),
      span: z.string(),
      occurrence: z.number().int().nullable(),
      explanation: z.string(),
      person_uses_this: z.boolean(),
    }),
  ),
});

/** What the judge needs to know about the person (calibration). */
export type JudgeProfile = {
  stats: Stats;
  typicality: number[];
  topPosts: string[];
  allowlist: string[];
  cacheKey: string;
};

export type Check = { tells: Tell[]; voiceMatch: VoiceMatch; hallucinated: number; usage: Usage };

/** Deterministic checks + LLM judge (spans verified by code) + allowlist + voice match. */
export async function checkDraft(text: string, p: JudgeProfile, userId: string): Promise<Check> {
  const input = [
    `AUTHOR HABITS (theirs, never flag): ${habits(p.stats).join("; ") || "none detected"}`,
    `AUTHOR'S POSTS:\n${untrusted("author_posts", p.topPosts)}`,
    `DRAFT:\n<draft>\n${text}\n</draft>`,
  ].join("\n\n");
  const { data, usage } = await structured("judge", JudgeOutput, "tells", { instructions: PROMPTS.judge.instructions, input, userId, cacheKey: `judge:${p.cacheKey}` });
  const { tells: llmTells, hallucinated } = verifySpans(text, data.flags);
  const tells = applyAllowlist([...detectCodeTells(text, capsFrom(p.stats)), ...llmTells], p.allowlist).sort((a, b) => a.start - b.start);
  return { tells, voiceMatch: voiceMatch(text, p.stats, p.typicality), hallucinated, usage };
}

/**
 * Rewrites the whole draft in the person's voice (voice card + learned rules) to remove the flagged tells.
 * One pass, used as is: no re-check.
 */
export async function humanize(text: string, tells: Tell[], voice: string, userId: string): Promise<{ text: string; usage: Usage }> {
  const problems = tells.filter((t) => t.status === "flagged");
  const input = [
    voice,
    `DRAFT:\n<draft>\n${text}\n</draft>`,
    `PROBLEMS TO FIX:\n${problems.map((t) => `- [${labelOf(t.category)}] "${t.text}": ${t.explanation}`).join("\n")}`,
  ].join("\n\n");
  const r = await streamText("humanize", { instructions: PROMPTS.humanize.instructions, input, userId }, () => {});
  return { text: cleanup(r.text), usage: r.usage };
}
