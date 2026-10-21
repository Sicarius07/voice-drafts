/**
 * Judge eval: runs the full judge path (deterministic checks + LLM judge + span verification + calibration)
 * on a small labelled set, twice, and reports agreement with the labels and with itself.
 *
 *   pnpm eval:judge            # all items
 *   pnpm eval:judge planted    # one set
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Tell } from "@/lib/judge/tells";
import { db, t } from "@/server/db";
import { PROMPTS } from "@/server/llm/prompts";
import { flushTraces } from "@/server/llm/tracing";
import { loadProfileCtx } from "@/server/services/context";
import { judgeProfileOf } from "@/server/services/generate";
import { checkDraft, type JudgeProfile } from "@/server/services/judge";

type Item = {
  id: string;
  set: "human" | "planted" | "calibration";
  voice: string;
  text?: string;
  tweetId?: string;
  op?: { type: "prepend" | "append" | "replace"; find?: string; text: string };
  /** Categories that must be flagged (empty = nothing may be flagged); `span` must overlap the flag. */
  expect: { category: string; span?: string }[];
  note?: string;
};

const RUNS = 2;
const dir = path.dirname(new URL(import.meta.url).pathname);

async function judgeProfileFor(username: string, cache: Map<string, JudgeProfile>) {
  if (cache.has(username)) return cache.get(username)!;
  const account = await db.query.xAccounts.findFirst({ where: eq(t.xAccounts.username, username) });
  if (!account) throw new Error(`No account @${username}; fetch or paste it first.`);
  const profile = await db.query.voiceProfiles.findFirst({ where: eq(t.voiceProfiles.xAccountId, account.id), orderBy: desc(t.voiceProfiles.createdAt) });
  if (!profile) throw new Error(`No profile for @${username}.`);
  const jp = judgeProfileOf(await loadProfileCtx(profile));
  cache.set(username, jp);
  return jp;
}

async function textOf(item: Item): Promise<string> {
  let text = item.text ?? (await db.query.tweets.findFirst({ where: eq(t.tweets.id, item.tweetId!) }))?.text;
  if (!text) throw new Error(`Item ${item.id}: no text and tweet ${item.tweetId} not in DB.`);
  const op = item.op;
  if (op?.type === "prepend") text = `${op.text}${text}`;
  if (op?.type === "append") text = `${text}${op.text}`;
  if (op?.type === "replace") text = text.replace(op.find!, op.text);
  return text;
}

const overlaps = (tell: Tell, text: string, span?: string) => {
  if (!span) return true;
  const start = text.indexOf(span);
  if (start < 0) return false;
  const shared = Math.min(tell.end, start + span.length) - Math.max(tell.start, start);
  return shared >= span.length * 0.5;
};

function passes(item: Item, text: string, tells: Tell[]) {
  const flagged = tells.filter((x) => x.status === "flagged");
  if (!item.expect.length) return flagged.length === 0;
  return item.expect.every((e) => flagged.some((f) => f.category === e.category && overlaps(f, text, e.span)));
}

async function main() {
  const only = process.argv[2];
  const { version, items }: { version: string; items: Item[] } = JSON.parse(await readFile(path.join(dir, "items.json"), "utf8"));
  const profiles = new Map<string, JudgeProfile>();
  const rows: { id: string; set: string; text: string; pass: boolean[]; flags: string[][]; hallucinated: number; cost: number; note?: string }[] = [];

  for (const item of items.filter((i) => !only || i.set === only)) {
    const text = await textOf(item);
    const jp = await judgeProfileFor(item.voice, profiles);
    const runs = await Promise.all(Array.from({ length: RUNS }, () => checkDraft(text, jp, "eval")));
    const row = {
      id: item.id,
      set: item.set,
      text,
      pass: runs.map((r) => passes(item, text, r.tells)),
      flags: runs.map((r) => r.tells.filter((x) => x.status === "flagged").map((x) => `${x.category}: "${x.text}"`)),
      hallucinated: runs.reduce((n, r) => n + r.hallucinated, 0),
      cost: runs.reduce((n, r) => n + r.usage.costUsd, 0),
      note: item.note,
    };
    rows.push(row);
    console.log(`${row.pass.every(Boolean) ? "✓" : row.pass.some(Boolean) ? "~" : "✗"} ${item.id.padEnd(5)} ${item.set.padEnd(11)} ${row.flags[0].join(" | ") || "(no flags)"}`);
  }

  const bySet = (set: string) => rows.filter((r) => r.set === set);
  const rate = (rs: typeof rows) => (rs.length ? rs.flatMap((r) => r.pass).filter(Boolean).length / (rs.length * RUNS) : null);
  /** A calibration pair (c1a + c1b) is correct in a run only if both of its sides pass. */
  const pairRate = (rs: typeof rows) => {
    const pairs = Object.values(Object.groupBy(rs, (r) => r.id.slice(0, -1))).map((p) => p!);
    const correct = pairs.flatMap((p) => Array.from({ length: RUNS }, (_, i) => p.every((r) => r.pass[i])));
    return correct.length ? correct.filter(Boolean).length / correct.length : null;
  };
  const summary = {
    judge: PROMPTS.judge.version,
    dataset: version,
    runs: RUNS,
    items: rows.length,
    humanFalsePositiveRate: rate(bySet("human")) === null ? null : 1 - rate(bySet("human"))!,
    plantedRecall: rate(bySet("planted")),
    calibrationAccuracy: pairRate(bySet("calibration")),
    runToRunAgreement: rows.length ? rows.filter((r) => r.pass.every((p) => p === r.pass[0])).length / rows.length : null,
    hallucinatedSpans: rows.reduce((n, r) => n + r.hallucinated, 0),
    costUsd: Number(rows.reduce((n, r) => n + r.cost, 0).toFixed(4)),
  };
  const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  const md = [
    `# Judge eval: ${summary.judge} on ${summary.dataset}`,
    "",
    `${summary.items} items × ${RUNS} runs · cost $${summary.costUsd}`,
    "",
    "| Metric | Result | Bar |",
    "|---|---|---|",
    `| False positives on human posts | ${pct(summary.humanFalsePositiveRate)} | ≤ 2 of 15 (≈13%) |`,
    `| Planted tells caught (category + span overlap) | ${pct(summary.plantedRecall)} | ≥ 12 of 15 (80%) |`,
    `| Calibration pairs correct | ${pct(summary.calibrationAccuracy)} | ≥ 80% |`,
    `| Same verdict on both runs | ${pct(summary.runToRunAgreement)} | reported |`,
    `| Hallucinated spans (rejected by code) | ${summary.hallucinatedSpans} | reported |`,
    "",
    "Single annotator (the builder), small n: a trust check, not a benchmark.",
    "",
    "## Misses",
    ...rows.filter((r) => !r.pass.every(Boolean)).map((r) => `- **${r.id}** (${r.set}): ${r.flags.map((f) => f.join("; ") || "no flags").join(" / ")}${r.note ? ` · ${r.note}` : ""}`),
  ].join("\n");
  await mkdir(path.join(dir, "results"), { recursive: true });
  // Results hold metrics and flag labels; post text stays out (X terms) except for synthetic items.
  const out = path.join(dir, "results", `${summary.judge}_${summary.dataset}`);
  await writeFile(`${out}.json`, JSON.stringify({ summary, rows: rows.map((r) => ({ ...r, text: undefined })) }, null, 2));
  await writeFile(`${out}.md`, md);
  console.log(`\n${md}`);
  await flushTraces();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
