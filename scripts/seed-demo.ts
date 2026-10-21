/**
 * Fetches the demo handles once (X credits: ≤ $1.01 each) and builds their shared profiles,
 * so reviewers can try the app without spending credits. Re-runs are free: fetched handles are cached in the DB.
 *
 *   DEMO_HANDLES=levelsio,paulg,naval pnpm seed:demo
 */
import { eq } from "drizzle-orm";
import { db, t } from "@/server/db";
import { flushTraces } from "@/server/llm/tracing";
import { ensureSharedProfile, normalizeHandle } from "@/server/services/voices";

const handles = (process.env.DEMO_HANDLES ?? "levelsio,paulg,naval").split(",").map(normalizeHandle);

async function main() {
  for (const handle of handles) {
    console.log(`\n@${handle}`);
    const { account, profile } = await ensureSharedProfile(handle, "seed", (e) => console.log(`  ${e.step ?? JSON.stringify(e)}`));
    await db.update(t.xAccounts).set({ isDemo: true }).where(eq(t.xAccounts.id, account.id));
    console.log(`  ✓ ${profile.tweetCount} posts · ${profile.stats.confidence} confidence · ${account.postsRead} posts read in total`);
  }
  await flushTraces();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
