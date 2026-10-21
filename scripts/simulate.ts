/**
 * Simulated run for the read-only showcase: a scripted user generates, edits, copies, picks and A/B-tests
 * drafts for 8 rounds on a fictional voice. The voice's old posts are full of hashtags, emoji, "!" and em
 * dashes; the user has quietly decided to drop all four. It shows the learning mechanism converging; it is
 * not evidence of real-world quality (that's what real users' blind A/B tests are for).
 *
 *   pnpm simulate          # replaces the previous showcase run
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { editBurden } from "@/lib/learning/diff";
import { emojis, extractHashtags } from "@/lib/text";
import type { ClientDraft } from "@/lib/types";
import { db, t } from "@/server/db";
import { flushTraces } from "@/server/llm/tracing";
import { loadVoiceCtx } from "@/server/services/context";
import { runBatch, type GenerateInput } from "@/server/services/generate";
import { recordAbChoice, recordFeedback, saveEdit } from "@/server/services/learning";
import { createVoice } from "@/server/services/voices";

const USER = { id: "showcase", name: "Simulated user", email: "showcase@voice-drafts.local" };
const HANDLE = "sim_founder";
const ROUNDS = 8;

/** Hidden preferences: each is checkable, and each has a deterministic fix that keeps the content. */
const HIDDEN = [
  { name: "no hashtags", violated: (s: string) => extractHashtags(s).length > 0, fix: (s: string) => s.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "") },
  { name: "no emoji", violated: (s: string) => emojis(s).length > 0, fix: (s: string) => emojis(s).reduce((acc, e) => acc.replace(e, ""), s) },
  { name: "no exclamation marks", violated: (s: string) => s.includes("!"), fix: (s: string) => s.replace(/!+/g, ".") },
  { name: "no em dashes", violated: (s: string) => s.includes("—"), fix: (s: string) => s.replace(/\s*—\s*/g, ", ") },
];

const tidy = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim())
    .join("\n")
    .replace(/\.{2,}/g, ".")
    .trim();
const violations = (s: string) => HIDDEN.filter((h) => h.violated(s));
const applyFixes = (s: string) => tidy(violations(s).reduce((acc, h) => h.fix(acc), s));

const NOTES = [
  "cut our onboarding from 4 screens to 2. activation went from 31% to 38%.",
  "launched a referral program last week. 12 signups came from referrals.",
  "moved pricing from 3 tiers to 2. fewer support emails asking which plan to pick.",
  "wrote docs for the API instead of a launch thread. docs page is now our top signup source.",
  "refunded an angry customer, they came back and upgraded a month later.",
  "turned off weekend deploys. zero pages last month.",
  "added a changelog page. people actually read it, 400 views in a week.",
  "hit $3,000 MRR this month.",
];

async function generate(voiceId: string, input: GenerateInput): Promise<ClientDraft[]> {
  const drafts: ClientDraft[] = [];
  await runBatch(await loadVoiceCtx(voiceId, USER.id), USER.id, input, (e) => {
    if (e.type === "draft") drafts.push(e.draft as ClientDraft);
    if (e.type === "draft_error") console.warn(`  draft ${e.idx} failed: ${e.message}`);
  });
  return drafts.sort((a, b) => a.idx - b.idx);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  await db.insert(t.user).values(USER).onConflictDoNothing();
  await db.delete(t.voices).where(and(eq(t.voices.userId, USER.id), eq(t.voices.isShowcase, true)));
  const corpus = await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fictional-founder.txt"), "utf8");
  const voiceId = await createVoice(USER.id, { handle: HANDLE, pasted: corpus }, () => {});
  await db.update(t.voices).set({ isShowcase: true }).where(eq(t.voices.id, voiceId));
  console.log(`showcase voice ${voiceId}\nhidden preferences: ${HIDDEN.map((h) => h.name).join("; ")}\n`);

  const table = ["| Round | Drafts meeting every preference | Violations per draft | Edit burden | Blind A/B |", "|---|---|---|---|---|"];
  for (let round = 1; round <= ROUNDS; round++) {
    const drafts = await generate(voiceId, { goal: "any", topic: null, notes: NOTES[round - 1], n: 3, mode: "normal" });
    const counts = drafts.map((d) => violations(d.text).length);
    const burdens: number[] = [];
    let learned = 0;
    for (const d of drafts) {
      if (!violations(d.text).length) {
        burdens.push(0);
        await recordFeedback(USER.id, d.id, "copy");
        continue;
      }
      const kept = applyFixes(d.text);
      burdens.push(editBurden(d.text, kept));
      const receipt = await saveEdit(USER.id, d.id, kept);
      learned += receipt.created.length + receipt.strengthened.length;
    }
    const best = drafts[counts.indexOf(Math.min(...counts))];
    if (best) await recordFeedback(USER.id, best.id, "pick");

    let ab = "";
    if (round >= 3 && round % 2 === 1) {
      const pair = await generate(voiceId, { goal: "any", topic: null, notes: NOTES[(round + 3) % NOTES.length], n: 1, mode: "ab" });
      if (pair.length === 2) {
        const [va, vb] = pair.map((d) => violations(d.text).length);
        const choice = va < vb ? "a" : vb < va ? "b" : "tie";
        const arms = await recordAbChoice(USER.id, pair[0].batchId, choice);
        ab = choice === "tie" ? "tie" : `picked ${arms["ab".indexOf(choice)]}`;
      }
    }
    const met = counts.filter((c) => c === 0).length;
    console.log(`round ${round}: ${met}/${drafts.length} met every preference · ${mean(counts).toFixed(1)} violations/draft · burden ${pct(mean(burdens))} · ${learned} rule update(s)${ab ? ` · A/B: ${ab}` : ""}`);
    table.push(`| ${round} | ${met}/${drafts.length} | ${mean(counts).toFixed(1)} | ${pct(mean(burdens))} | ${ab || "·"} |`);
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
