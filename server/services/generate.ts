import "server-only";
import { angleBrief, eligibleFormulas, FORMULAS, type FormulaId, type Goal } from "@/lib/angles";
import { engagementLabel, selectExamples, type ExamplePost } from "@/lib/generate/examples";
import { splitHints } from "@/lib/generate/placeholders";
import { cleanup, validate, type ValidationContext } from "@/lib/generate/validate";
import { meter, needsHumanize } from "@/lib/judge/tells";
import { pickAngles } from "@/lib/learning/bandit";
import { renderRules, rulesForPrompt } from "@/lib/learning/rules";
import { voiceMatch } from "@/lib/profile/voice-match";
import { untrusted } from "@/lib/text";
import type { DraftArm } from "@/lib/types";
import { db, t } from "@/server/db";
import { addUsage, EFFORT, MODEL, streamText, type Call } from "@/server/llm/client";
import { PROMPTS } from "@/server/llm/prompts";
import { traced } from "@/server/llm/tracing";
import type { ProfileCtx, VoiceCtx } from "./context";
import { checkDraft, humanize, type JudgeProfile } from "./judge";
import { loadPosteriors } from "./learning";
import type { Send } from "./voices";
import { toClientDraft } from "./workspace";

export type GenerateInput = { goal: Goal | "any"; topic: string | null; notes: string; n: number; mode: "normal" | "ab" };

/** Calibration context for the judge: the person's stats, voice card and top posts. */
export const judgeProfileOf = (ctx: ProfileCtx, allowlist: string[] = []): JudgeProfile => ({
  stats: ctx.profile.stats,
  typicality: ctx.typicality,
  allowlist,
  cacheKey: ctx.profile.id,
  topPosts: ctx.corpus
    .filter((p) => !p.mediaDependent)
    .sort((a, b) => (b.engagement?.overall ?? 0) - (a.engagement?.overall ?? 0))
    .slice(0, 5)
    .map((p) => p.text),
});

/** Prompt layers, stable → volatile so the shared prefix (voice card, rules) is cached across a batch. */
function promptInput(ctx: VoiceCtx, rulesBlock: string, formula: FormulaId, examples: ExamplePost[], input: GenerateInput, others: string[]) {
  return [
    ctx.card,
    rulesBlock,
    angleBrief(formula),
    `EXAMPLES (real posts by the author, picked for this topic and goal; match the voice, never copy):\n${untrusted(
      "example_posts",
      examples.map((e) => ({ post: e.text, performance: engagementLabel(e.engagement, input.goal) })),
    )}`,
    `TOPIC: ${input.topic ?? "the author's choice, from their usual topics"}`,
    `<user_notes>\n${input.notes.trim() || "(none: write an opinion or observation; use placeholders for any fact)"}\n</user_notes>`,
    others.length ? `Other drafts in this batch use these angles: ${others.join(", ")}. Take a different line from them.` : "",
    "Write the post now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const repairInput = (call: Call, text: string, errors: ReturnType<typeof validate>["errors"]) =>
  `${call.input}\n\nYour previous draft:\n<draft>\n${text}\n</draft>\nIt failed these checks:\n${errors
    .map((e) => `- ${e.message}${e.items.length ? ` (${e.items.slice(0, 5).join(", ")})` : ""}`)
    .join("\n")}\nFix only these problems and output the corrected post.`;

const shuffle = <T>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

/**
 * One batch: the bandit picks angles, each draft streams in, then gets validated (one repair),
 * judged, humanized if needed, and saved with full provenance. A/B mode = one angle, two arms
 * (with vs without learned rules), in random positions.
 */
export const runBatch = (ctx: VoiceCtx, userId: string, input: GenerateInput, send: Send) =>
  traced("generate-batch", { userId, sessionId: ctx.voice.id, input }, () => draftBatch(ctx, userId, input, send));

async function draftBatch(ctx: VoiceCtx, userId: string, input: GenerateInput, send: Send) {
  const ab = input.mode === "ab";
  const formulas = pickAngles(await loadPosteriors(ctx.voice.id), eligibleFormulas(input.goal, input.notes), ab ? 1 : Math.min(5, Math.max(1, input.n)), {
    fallback: eligibleFormulas("any", input.notes),
  });
  const plan: { formula: FormulaId; arm: DraftArm }[] = ab
    ? shuffle<DraftArm>(["learned", "baseline"]).map((arm) => ({ formula: formulas[0], arm }))
    : formulas.map((formula) => ({ formula, arm: "normal" }));
  const [batch] = await db
    .insert(t.batches)
    .values({ voiceId: ctx.voice.id, userId, goal: input.goal, topic: input.topic, notes: input.notes, kind: ab ? "ab" : "normal" })
    .returning();
  send({
    type: "batch",
    batch: { id: batch.id, kind: batch.kind, goal: batch.goal, topic: batch.topic, notes: batch.notes, createdAt: batch.createdAt.toISOString(), ab: null },
    angles: plan.map((p, idx) => ({ idx, formula: p.formula, angle: FORMULAS[p.formula].name })),
  });

  const examples = selectExamples(ctx.corpus, { topic: input.topic, goal: input.goal });
  const judgeProfile = judgeProfileOf(ctx, ctx.voice.allowlist);
  const vctx: ValidationContext = { notes: input.notes, corpus: ctx.corpus.map((p) => p.text) };
  const learned = rulesForPrompt(ctx.rules);
  const names = plan.map((p) => FORMULAS[p.formula].name);

  await Promise.all(
    plan.map(async ({ formula, arm }, idx) => {
      try {
        const rules = arm === "baseline" ? [] : learned;
        const rulesBlock = renderRules(rules);
        const others = ab ? [] : names.filter((_, i) => i !== idx);
        const call: Call = { instructions: PROMPTS.generate.instructions, input: promptInput(ctx, rulesBlock, formula, examples, input, others), userId, cacheKey: ctx.voice.id };

        const first = await streamText("generate", call, (d) => send({ type: "delta", idx, d }));
        let usage = first.usage;
        // Placeholder hints ("[your metric: …]") are stored apart from the text; everything downstream sees "[your metric]".
        let { text, hints } = splitHints(cleanup(first.text));
        let v = validate(text, vctx);
        const repaired = v.errors.length > 0;
        if (repaired) {
          const fix = await streamText("generate", { ...call, input: repairInput(call, cleanup(first.text), v.errors) }, () => {});
          usage = addUsage(usage, fix.usage);
          ({ text, hints } = splitHints(cleanup(fix.text)));
          v = validate(text, vctx);
        }
        send({ type: "text", idx, text });

        const check = await checkDraft(text, judgeProfile, userId);
        usage = addUsage(usage, check.usage);
        // Enough tells → one full rewrite in their voice, used as is. `tells` keep describing the original (`humanize.before`).
        const humanized = needsHumanize(meter(check.tells)) ? await humanize(text, check.tells, [ctx.card, rulesBlock].filter(Boolean).join("\n\n"), userId) : null;
        if (humanized) usage = addUsage(usage, humanized.usage);
        const shown = humanized?.text ?? text;

        const [row] = await db
          .insert(t.drafts)
          .values({
            batchId: batch.id,
            voiceId: ctx.voice.id,
            idx,
            arm,
            formula,
            textRaw: first.text,
            textShown: shown,
            textHumanized: humanized ? shown : null,
            model: MODEL,
            effort: EFFORT.generate,
            promptVersion: PROMPTS.generate.version,
            judgeVersion: PROMPTS.judge.version,
            profileId: ctx.profile.id,
            rulesetVersionId: arm === "baseline" ? null : ctx.voice.rulesetVersionId,
            exampleIds: examples.map((e) => e.id),
            ruleIds: rules.map((r) => r.id),
            validation: { ...(shown === text ? v : validate(shown, vctx)), repaired },
            tells: check.tells,
            voiceMatch: humanized ? voiceMatch(shown, ctx.profile.stats, ctx.typicality) : check.voiceMatch,
            humanize: humanized && { before: text },
            placeholderHints: hints,
            usage,
            prompt: `${call.instructions}\n\n---\n\n${call.input}`,
          })
          .returning();
        send({ type: "draft", idx, draft: toClientDraft(row, ctx, undefined, ab) });
      } catch (err) {
        send({ type: "draft_error", idx, message: err instanceof Error ? err.message : "Something went wrong." });
      }
    }),
  );
  send({ type: "done" });
}
