/**
 * Showcase voice: a scripted user works with @okara_eng for 14 rounds through the real pipeline. @okara_eng is
 * fictional: an inference engineer whose post history (fixtures/okara-eng.txt) the model wrote in the style of
 * real AI-infra posts. Those old posts wander, use emoji, setup openers, "lesson:" closers, "imo", ALL-CAPS and
 * a) b) c) lists; the user has moved away from them and picks up new preferences as the run goes (like real taste), so
 * each new one costs a few edits before the system learns it. An LLM plays the user: it posts drafts that already
 * fit, edits the rest (only what its preferences require), keeps tentative rules it agrees with and undoes the
 * rest, and answers blind A/B tests. A mechanism demo, not evidence of real-world quality.
 *
 *   pnpm showcase          # replaces the previous showcase run (~$2 of OpenAI, no X credits)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { editBurden } from "@/lib/learning/diff";
import type { ClientDraft } from "@/lib/types";
import { db, t } from "@/server/db";
import { structured } from "@/server/llm/client";
import { flushTraces } from "@/server/llm/tracing";
import { loadVoiceCtx } from "@/server/services/context";
import { runBatch, type GenerateInput } from "@/server/services/generate";
import { recordAbChoice, recordFeedback, ruleAction, saveEdit } from "@/server/services/learning";
import { createVoice } from "@/server/services/voices";

const USER = { id: "showcase", name: "okara eng", email: "showcase@voice-drafts.local" };
const HANDLE = "okara_eng";
const ACCOUNT = { name: "okara eng", avatarUrl: "/avatars/okara_eng.jpg", bio: "inference @ a small ai startup. making open models fast and cheap. opinions are my gpu's" };
const AB_ROUNDS = new Set([4, 7, 10, 13]);

/** The user's taste, and the round where each preference shows up. Their old posts break most of these. */
const PREFERENCES = [
  { from: 1, text: "One point per post: cut any paragraph that wanders from the main result (side stories, caveats about other setups, asides)." },
  { from: 1, text: 'No setup line before the substance ("ok story time", "let me explain", "here\'s the thing:", "thread time"): start with the substance.' },
  { from: 1, text: 'No closing lesson line ("lesson:", "moral of the story:", "the takeaway:"): end on the concrete result.' },
  { from: 1, text: "No emoji." },
  { from: 3, text: 'No "imo", "tbh" or "ngl": state the opinion plainly.' },
  { from: 3, text: 'No ALL-CAPS emphasis ("WAY faster", "NOT the kernel"): let the number carry the weight.' },
  { from: 6, text: "No a) b) c) or numbered lists: write steps as short sentences in a paragraph." },
  { from: 9, text: 'Write every change as before → after with units ("1.9s → 640ms"), never "went from X to Y" or "dropped by X%".' },
  { from: 11, text: "No rhetorical questions." },
];
const prefsAt = (round: number) => PREFERENCES.filter((p) => p.from <= round).map((p) => p.text);

const ROUNDS: { notes: string; goal: GenerateInput["goal"] }[] = [
  { goal: "any", notes: "moved our qwen 32b endpoint from fp8 to fp4 weights on b200s. per-request decode 38 → 52 tok/s. our customer eval set moved 0.4 points, inside run-to-run noise" },
  { goal: "bookmarks", notes: "turned on prefix caching for the agents customer. hit rate 71%, prefill tokens per request down 3.1x, p95 ttft 1.9s → 640ms" },
  { goal: "replies", notes: "speculative decoding with a 1b draft on the 70b: 2.3 accepted tokens per step, 1.6x faster decode at batch 1, 8% slower at batch 32. it now switches off above batch 16" },
  { goal: "any", notes: "3am page: one tenant's 20k-token prompts filled the kv cache, evictions spiked, p99 went 2s → 19s. fix was a per-tenant cache quota" },
  { goal: "reposts", notes: "wrote a triton kernel fusing dequant + matmul. 1.9x faster in isolation, 4% end to end, because that matmul was 11% of decode time" },
  { goal: "bookmarks", notes: "cost per million output tokens on the llama 70b pool went $0.92 → $0.61 after moving from 8 h100s to 4 b200s with fp8" },
  { goal: "likes", notes: "a quantized model held mmlu within 0.2 points, but one customer's json extraction failures went 0.3% → 4%. their schema tests are in our golden set now" },
  { goal: "any", notes: "served the new moe release on day one. expert parallel across 8 gpus; all-to-all was 31% of step time until we packed tokens per expert. now 12%" },
  { goal: "replies", notes: "agent traffic: 70% of requests are tool-call turns under 300 output tokens. tuned the scheduler for ttft over throughput, p95 ttft 900ms → 380ms" },
  { goal: "bookmarks", notes: "postmortem: a config change disabled cuda graphs in prod for 6 hours. decode throughput dropped 22% and nothing alerted. we alert on tokens/sec per gpu now" },
  { goal: "likes", notes: "one year in inference: the profiler was right every time i was sure it was wrong. reading the vllm scheduler taught me more than the last 5 papers i read" },
  { goal: "reposts", notes: "a vendor chart used 128 input tokens. our customers' median is 2,400. at 2,400 our ttft is 1.3x faster than theirs; at 128 theirs wins" },
  { goal: "any", notes: "rented 16 h100s for a burst week, $11k. the dashboard said 85% utilization; tokens/sec said 54%, idle replicas during rollouts" },
  { goal: "bookmarks", notes: "chunked prefill with 2048-token chunks: p99 inter-token latency 210ms → 70ms while long prompts are in flight, throughput -3%" },
];
const AB_NOTES = [
  "tensor parallel 8 → 4 on the 70b, running 2 replicas instead of 1: throughput +41%, p50 latency +18%",
  "int4 awq on the 1b draft model made it 30% faster, but acceptance dropped from 2.4 to 1.9 tokens per step",
  "moved tokenization off the gpu workers onto the gateway: 6% gpu time back, +3ms p50",
  "fp8 kv cache on the 32b: 1.7x more concurrent requests per gpu, no measurable change on our evals",
];

const Review = z.object({ verdict: z.enum(["post", "edit", "skip"]), edited: z.string().nullable(), why: z.string() });
const RuleReview = z.object({ decisions: z.array(z.object({ id: z.string(), action: z.enum(["confirm", "archive"]) })) });
const AbPick = z.object({ choice: z.enum(["a", "b", "tie", "neither"]) });

const persona = (prefs: string[]) =>
  `You are @${HANDLE}, an inference engineer, working with an assistant that drafts X posts in your voice. Your old posts had habits you've since dropped. Your current preferences:\n${prefs.map((p) => `- ${p}`).join("\n")}`;

const ask = <S extends z.ZodType>(schema: S, name: string, instructions: string, input: string) =>
  structured("showcase", schema, name, { instructions, input, userId: USER.id }).then((r) => r.data as z.infer<S>);

/** The scripted user reads one draft: post it, edit only what its preferences require, or skip it. */
const review = (text: string, notes: string, prefs: string[]) =>
  ask(
    Review,
    "review",
    `${persona(prefs)}

Read the draft. If it breaks none of your preferences and gets the notes right, verdict "post" (edited = null).
If it breaks any preference, verdict "edit": return the full post with only those problems fixed: delete a setup or lesson line entirely, cut a whole paragraph when it's too long, reword only the sentences that break a preference. Keep every other line exactly as written, including line breaks. Fill any [placeholder] from the notes.
Verdict "skip" if the draft gets the notes wrong, or if fixing it would mean rewriting most of it.`,
    `<notes>\n${notes}\n</notes>\n\n<draft>\n${text}\n</draft>`,
  );

async function generate(voiceId: string, input: GenerateInput): Promise<ClientDraft[]> {
  const drafts: ClientDraft[] = [];
  await runBatch(await loadVoiceCtx(voiceId, USER.id), USER.id, input, (e) => {
    if (e.type === "draft") drafts.push(e.draft as ClientDraft);
    if (e.type === "draft_error") console.warn(`  draft ${e.idx} failed: ${e.message}`);
  });
  return drafts.sort((a, b) => a.idx - b.idx);
}

/** Tentative rules the user agrees with get confirmed; the rest get undone, like hitting Undo on the toast. */
async function reviewRules(voiceId: string, prefs: string[]) {
  const candidates = await db.select().from(t.rules).where(and(eq(t.rules.voiceId, voiceId), eq(t.rules.status, "candidate")));
  if (!candidates.length) return [];
  const { decisions } = await ask(
    RuleReview,
    "rule_review",
    `${persona(prefs)}\n\nThe assistant learned these tentative rules from your edits. Confirm a rule if it states one of your preferences; archive every other one (a side effect of an edit, or not something you want).`,
    candidates.map((r) => `${r.id}: ${r.text}`).join("\n"),
  );
  const known = decisions.filter((d) => candidates.some((c) => c.id === d.id));
  for (const d of known) await ruleAction(USER.id, d.id, d.action);
  return known.map((d) => `${d.action} "${candidates.find((c) => c.id === d.id)!.text}"`);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function main() {
  await db.insert(t.user).values(USER).onConflictDoUpdate({ target: t.user.id, set: { name: USER.name } });
  await db.delete(t.voices).where(and(eq(t.voices.userId, USER.id), eq(t.voices.isShowcase, true)));
  const corpus = await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "okara-eng.txt"), "utf8");
  const voiceId = await createVoice(USER.id, { handle: HANDLE, pasted: corpus }, () => {});
  const voice = (await db.query.voices.findFirst({ where: eq(t.voices.id, voiceId) }))!;
  await db.update(t.voices).set({ isShowcase: true }).where(eq(t.voices.id, voiceId));
  await db.update(t.xAccounts).set(ACCOUNT).where(eq(t.xAccounts.id, voice.xAccountId));
  const topics = (await loadVoiceCtx(voiceId, USER.id)).profile.qualities.topics.map((x) => x.label);
  console.log(`showcase voice ${voiceId} · topics: ${topics.join(", ")}\n`);

  const table = ["| Round | Posted as is | Edited | Skipped | Words kept | Rules |", "|---|---|---|---|---|---|"];
  for (const [i, round] of ROUNDS.entries()) {
    const n = i + 1;
    const prefs = prefsAt(n);
    const drafts = await generate(voiceId, { goal: round.goal, topic: i % 2 ? (topics[i % topics.length] ?? null) : null, notes: round.notes, n: 3, mode: "normal" });
    const used: { id: string; burden: number }[] = [];
    let skipped = 0;
    for (const d of drafts) {
      const r = await review(d.text, round.notes, prefs);
      if (r.verdict === "skip") {
        skipped++;
        await recordFeedback(USER.id, d.id, "delete");
        continue;
      }
      if (r.verdict === "edit" && r.edited && r.edited.trim() !== d.text.trim()) {
        await saveEdit(USER.id, d.id, r.edited);
        used.push({ id: d.id, burden: editBurden(d.text, r.edited) });
      } else used.push({ id: d.id, burden: 0 });
      await recordFeedback(USER.id, d.id, "copy");
    }
    const best = [...used].sort((a, b) => a.burden - b.burden)[0];
    if (best) await recordFeedback(USER.id, best.id, "pick");
    const ruleChanges = await reviewRules(voiceId, prefs);

    if (AB_ROUNDS.has(n)) {
      const pair = await generate(voiceId, { goal: "any", topic: null, notes: AB_NOTES[[...AB_ROUNDS].indexOf(n)], n: 1, mode: "ab" });
      if (pair.length === 2) {
        const { choice } = await ask(AbPick, "ab_pick", `${persona(prefs)}\n\nTwo drafts of the same post. Which would you post: a, b, tie (equally good) or neither?`, `<draft_a>\n${pair[0].text}\n</draft_a>\n\n<draft_b>\n${pair[1].text}\n</draft_b>`);
        const arms = await recordAbChoice(USER.id, pair[0].batchId, choice);
        ruleChanges.push(`A/B: ${choice.length === 1 ? `picked ${arms["ab".indexOf(choice)]}` : choice}`);
      }
    }
    const asIs = used.filter((u) => u.burden === 0).length;
    const kept = used.length ? 1 - used.reduce((s, u) => s + u.burden, 0) / used.length : 0;
    console.log(`round ${n}: ${asIs} as is · ${used.length - asIs} edited · ${skipped} skipped · words kept ${pct(kept)}${ruleChanges.length ? ` · ${ruleChanges.join("; ")}` : ""}`);
    table.push(`| ${n} | ${asIs} | ${used.length - asIs} | ${skipped} | ${pct(kept)} | ${ruleChanges.join("; ") || "·"} |`);
  }

  const rules = await db.select().from(t.rules).where(eq(t.rules.voiceId, voiceId));
  console.log(`\n${table.join("\n")}\n\nlearned rules:`);
  rules.forEach((r) => console.log(`  [${r.status}] ${r.text} (${r.evidenceCount} edit(s))`));
  await flushTraces();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
