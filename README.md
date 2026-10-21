# Voice Drafts

Drafts for X in your own voice, from a tool that learns from every edit you make.

- **Live:** _deploy pending_
- **60-second tour:** sign in → pick a demo voice (or paste your own posts) → Generate → edit one draft and save → watch the
  "New tentative rule" toast → Generate again (open "Why this draft?") → click **Compare with/without learning** and pick blind.

```
handle ─▶ X API (once, cached) ─▶ posts ─▶ stats (code) + qualities (LLM, verified by code) ─▶ profile
                                                         │
notes + goal + topic ─▶ angle bandit ─▶ examples ─▶ prompt ─▶ generate ─▶ validators (code) ─▶ judge (LLM)
                                                         │                                  ─▶ spans verified (code)
                                                         ▼                                  ─▶ humanize (one rewrite in voice)
                        draft card: voice match + AI tells ─▶ copy / edit / 👍👎 / pick / delete / A/B
                                                         │
                         edit ─▶ diff ─▶ rule proposed (LLM) ─▶ rule verified (code) ─▶ next batch uses it
```

**One principle runs through it:** code measures and enforces hard limits, the LLM judges fuzzy qualities, and code
verifies every claim the LLM makes.

## Decisions and why

| Area | Decision | Why (and what I didn't do) |
|---|---|---|
| Tweet data | Official X API, **fetched once per handle and shared** by all users; originals only (`exclude=replies,retweets`), ≤ 200 posts (≤ $1.01 per handle). Paste fallback. | X reads are the main cost ($0.005/post). Excluding replies means every paid read is an original. Each post's raw API object is kept in `tweets.raw`, so normalization can be re-run without paying again. Cost of that choice: no replies-vs-originals or thread stats (a two-phase fetch that recovers them is designed in the plan). |
| Voice profile | **Stats by code** (twitter-text weighted length, casing, punctuation, emoji, hashtags…) + **qualities by the LLM**, where every claim is checked: quoted phrases must occur ≥ 2× in the posts, "never uses" words 0×, signature posts are referenced by id and copied verbatim, topics must cite real post ids. | Unverifiable claims are dropped and counted. An LLM describing your voice is useful; an LLM misquoting you is not. |
| Two meters | **Voice match** = how typical the draft is of you, as a percentile against your own posts ("72" = more typical than 72% of them), from style features only. **AI tells** = Clean / Minor / Needs work, never a "% AI" score. | AI detectors are unreliable on tweet-length text. The tells meter names specific phrases readers react to, highlights them inline and explains them. |
| AI-tell judge | LLM judge using the x-skills tell catalog as rubric; it must quote the exact span; **code verifies each span exists** (rejecting hallucinated ones) and sets severity from the catalog. A small deterministic layer covers the countable checks (hashtags, emoji, em dashes, model leakage like `[Your Name]`). | Calibrated per person: countable patterns are capped at 0 if the person never uses them, otherwise at their own 90th percentile; the judge sees their top posts and marks patterns they use themselves as "you do this too" (not counted); "This is fine for me" allowlists a category for that voice. |
| Humanize | Only when a draft has a blocker or ≥ 2 warnings: **one full rewrite** that gets the voice card, the learned rules and the flagged spans with their explanations. Used as is, no re-check; the card shows "Rewritten", and "Show original" highlights what was flagged. | Simple and predictable: one extra call, only for drafts that need it. Clean drafts are never touched. Patching spans was tried first (see "Changed while building"). |
| Never invent facts | A hard rule in the generation prompt: numbers, names, links and @mentions come from your notes, otherwise placeholders like `[your number]`. Code still blocks brackets that aren't allowed placeholders, and warns on multi-word names that aren't in your notes or past posts. | A code fact guard was built and dropped (see "Changed while building"). You review every draft before posting. |
| Angles | Hook formulas ported from x-skills (contrarian one-liner, data-point, build-in-public, mini-list, relatable cold-open, third-person case study), filtered by goal, picked by a **Beta-per-angle Thompson-sampling bandit** per voice. When a goal has fewer angles than drafts (Likes has one), other goals' angles fill the rest. | ~30 lines; learns which shapes you keep. |
| Model | `gpt-6.1-sol` for every call (effort `medium` for generation, judge, humanize and profile; `low` for rule mining). Model, effort and prompt version are stored on every draft. | One model keeps the system simple and cheap (~$0.01 per draft including the judge). Current OpenAI reasoning models don't take `temperature`, so reproducibility comes from pinned versions plus measured run-to-run agreement. |
| Auth | Better Auth (GitHub), Drizzle adapter. | Auth.js is in security-only maintenance; Better Auth is actively maintained. |
| Stack | Next.js 16 (App Router, Cache Components), Postgres on Neon, Drizzle, shadcn/ui + Tailwind, official `openai` SDK (Responses API), Vitest. | Drafts stream as NDJSON from a Route Handler; mutations are server actions. |

## The learning loop

Every interaction is a typed event in `feedback_events` and updates one of two levers.

| Signal | What it updates |
|---|---|
| **Edit + save** (richest) | Word diff → the LLM labels hunks style/content/typo and proposes ≤ 2 rules from style hunks → **code keeps a rule only if its detector is violated by the shown draft and satisfied by your edit** (e.g. "Keep it under 100 characters", "Don't use 'just'"). Free-form style notes are allowed but only become active when you confirm them. Placeholder fills are ignored. |
| Copy, 👍, pick best | Angle reward 1 |
| Edit | Angle reward 0.5 |
| 👎 (with reason chips), delete | Angle reward 0 |
| "Not these, try again" | Weak negative for each draft in the batch |
| "This is fine for me" on a highlight | Judge allowlist for that voice |
| Blind A/B choice | The headline metric |

**Visible within 2–3 interactions:** the first style edit creates a *tentative* rule immediately (toast with **Undo**), the next batch applies it ("Why this draft?" lists it), and the A/B button unlocks.

**Rule states:** tentative → active (a second supporting edit, or Confirm) → archived (Undo, archive, or you put the pattern back: once for tentative rules, twice for active ones). Every change writes a ruleset version; any version can be restored. Max 10 rules go into the prompt; hard rules (facts, length, never posting) always outrank learned ones.

**How it's measured**

- **Blind A/B (headline):** same angle, same example posts, same notes; the only difference is your learned rules. Random positions, arms revealed after you choose. Win rate with a Wilson 95% interval.
- **Trends:** acceptance rate (copied, liked or picked) and edit burden (share of words you change), rolling over 3 batches. Labelled as confounded: users change too.
- **Simulated run (read-only showcase):** a fictional founder whose old posts are full of hashtags, emoji, `!` and em dashes,
  and a scripted user who has quietly decided to drop all four. Each round: 3 drafts; the user copies the clean ones,
  fixes the rest by deleting exactly those things (content untouched), picks the best; a blind A/B every other round.
  `pnpm simulate`, 8 rounds, ~$0.70:

  | Round | Drafts meeting every hidden preference | Violations per draft | Blind A/B |
  |---|---|---|---|
  | 1 | 0/3 | 2.3 | |
  | 2 | 3/3 | 0.0 | |
  | 3–8 | 18/18 | 0.0 | learned arm picked 3/3 |

  Round 1's three edits (7 deletions: 3 hashtags, 3 emoji, 1 em dash) produced "No hashtags" (3 supporting edits,
  active), "No emoji" (2, active) and "No em dashes" (1, tentative), each verified by its detector against the edit.
  The next batch applied them. In the A/B pairs the baseline arm kept the old habits ("…read it — 400 views in a week
  😅 #buildinpublic") and the learned arm didn't. "No exclamation marks" was never learned because no draft used `!`.
  This shows the mechanism works on simple, checkable preferences; it says nothing about fuzzier ones, which is what
  real users' blind A/B is for.

## Measuring the judge

40 hand-labelled items, each judged twice through the full path (code checks, LLM judge, span verification,
calibration), with pass bars set before the first run. `pnpm eval:judge`, ~$0.10–0.20 per run. Items reference post
IDs; no post text is committed. Each run writes its report to `evals/judge/results/` (not committed).

| Metric | v1 | v1.1 | Bar |
|---|---|---|---|
| Human posts falsely flagged (15) | 27% | **17%** | ≤ 13% ✗ |
| Planted tells caught, right category and span (15) | 100% | **100%** | ≥ 80% ✓ |
| Calibration pairs right on both sides (5) | 80% | **80%** | ≥ 80% ✓ |
| Same verdict on both runs | 100% | 98% | reported |
| Hallucinated spans rejected by code | 3 | 2 | reported |

- **v1 → v1.1 changed the sample, not the judge.** Three of v1's four false positives were quote posts ("Hari nails it:")
  whose first line points at the quoted post, which the judge never sees. The app only writes standalone posts, so v1.1
  draws the human sample from standalone originals (same every-Nth rule). Both results are kept.
- **What still fails:** two real human posts use negative parallelism (levelsio: "…is not a bottle of wine… But fresh
  coffee beans"; paulg: "wouldn't slow down the rate of progress in AI. It would merely…"). The judge is right by the
  rubric, but it's their habit. Calibration only catches a habit if it shows up in the 5 posts the judge sees, and here
  it didn't. The fix I'd make next is to calibrate against the whole corpus (does this person use this pattern at
  all?) instead of the top 5. I didn't tune on this set. Until then, "This is fine for me" covers it per voice.
- **The calibration miss** is c4b ("The rich man is not the one who has the most. / The rich man is the one who needs the
  least." under paulg). I labelled it negative parallelism; the judge disagreed on both runs. It's closer to an
  antithesis than the catalog's "it's not X, it's Y" correction, so my label may be the problem.
- **Code calibration works as intended:** the same text with a hashtag, emoji or em dash is flagged for someone who never
  uses it and not for someone who does (4 of 4 code pairs).

Single annotator (me), small n: a trust check, not a benchmark.

## Costs and abuse controls

- X: ≤ $1.01 per new handle (one lookup + ≤ 200 posts), fetched once for everyone; refresh reads only new posts. Demo handles are pre-seeded.
- OpenAI: ~$0.01 per draft including the judge; ~$0.015 per learned edit; ~$0.02 per profile.
- No per-user caps in v1 (a deliberate scope cut): both API accounts are prepaid with auto-recharge off, so the balance is the hard ceiling. The ledger/quota design is in the plan if this needs to be public for longer.

## Security

- LLM calls and keys are server-only (`server-only` imports; nothing `NEXT_PUBLIC_`).
- The app holds only an app-only X bearer token, which **cannot post**. Drafts are never published by the app.
- Fetched posts, bios and pasted text are untrusted: serialized as JSON inside `<untrusted_*>` tags with `<` escaped, plus a policy line in every system prompt. The generation prompt only allows links and @mentions from your notes. That is an instruction, not code enforcement (the code fact guard was dropped), but drafts are never posted for you, so a planted link would have to get past your review.

## Tracing (optional)

Every LLM call goes through `server/llm/client.ts`, which records it as a Langfuse generation when the `LANGFUSE_*` keys
are set: prompt, output, tokens (cached and reasoning split out) and cost. We compute the cost ourselves, since Langfuse has no price
for this model. The calls in a batch (generate, repair, judge, humanize per draft) nest under one `generate-batch` trace,
with the voice as the session, so a voice's batches line up over time. Langfuse gets its own tracer provider, so Next.js
request spans stay out, and spans are flushed with `waitUntil` on Vercel. With the keys unset, it's a no-op. Prompts
include fetched posts, so the Langfuse project sees those too.

## Changed while building (and why)

- **Voice match scored real drafts 0.** It counted digits as style, and every draft with your numbers looked off-voice. Now it
  uses style features only (relative likelihood per feature) and is computed on load, so it can't go stale.
- **Countable tells were capped at 1 even for people who never use them.** Now: 0 if you never do it, else your own 90th
  percentile. Found while building the calibration pairs.
- **The case-study angle fired on my own results** ("[name] launched…"). It now needs a third-party name plus a number in the notes.
- **The rule miner preferred free-form style notes**, which can't be verified. Its prompt now prefers checkable kinds.
- **Dropped connections lost drafts** (7 of 28 in one simulation run). Each LLM call now retries once on a dropped
  connection, with a 2-minute timeout instead of the SDK's 10.
- **Refresh on a demo handle would rebuild the shared profile for everyone.** Demo voices stay as seeded, and a refresh with
  no new posts skips the rebuild.
- **Dropped the code fact guard.** It checked every number, link and @mention in a draft against the notes, but number
  detection was heuristic (list markers, times, "web3", ranges) and kept misfiring. The prompt's hard rule and your review
  now carry it.
- **Humanize went from patching spans to one full rewrite.** Span patches applied by code kept the rest of the text intact,
  but when most of a post was flagged the patched result read flat, and the re-check plus guard cost a second judge call.
  Now: one rewrite with the voice card and learned rules, no re-check.
- **Engagement ranked a person's most-liked post near the bottom.** It used likes per impression, and the most-viewed post
  converts the lowest share. It now ranks raw counts within the person's own posts (count = reach × conversion).
- **A Reposts or Likes batch repeated one angle** (those goals have one angle each). Other goals' angles now fill the rest.
- **The first simulation taught nothing:** its hidden preferences already matched the voice. It now uses a persona whose
  habits the user wants to drop.

## Designed, not built

Two-phase fetch (reply/thread stats) · per-user quotas and a cost ledger · embeddings + pgvector + MMR for examples ·
example-credit learning · stat-drift rules · usage-based rule decay and conflict detection · prompt-cache prewarm and the
Flex tier · temporal-holdout replay and a "spot the fake" discriminator eval · judge re-scoring on version change · history
screen and profile diffs · moderation · X archive import, threads and long posts, learning from real post engagement.

## Credits

The tell catalog, hook formulas, voice-profile structure and untrusted-content policy are ported from
[x-skills](https://github.com/sergebulaev/x-skills) by Sergey Bulaev (MIT). Each ported file says what changed. Its corpus
statistics are treated as unverified vendor claims and not quoted.

## Code map

```
app/          routes: pages, the streaming API routes, server actions (app/actions.ts)
components/   UI (shadcn primitives in components/ui)
server/       backend; files that hold keys or touch the DB import "server-only", so the build fails if the browser imports them
  services/   orchestration: voices (fetch + profile), generate (one batch), judge, learning, workspace (what pages read)
  llm/ x/ db/ OpenAI client + prompts + Langfuse tracing, X API client, Drizzle schema
  auth.ts     Better Auth + getUser / requireUser
  ndjson.ts   streaming responses
lib/          pure logic, no I/O, shared by server and browser, unit-tested: text, profile, generate, judge, learning, angles
```

`lib/` never imports from `server/`. To read the core: `server/services/generate.ts` → `server/services/judge.ts` →
`saveEdit` in `server/services/learning.ts`.

## Local setup

```bash
pnpm install
cp .env.example .env.local          # fill in keys; DATABASE_URL can be a local Postgres
pnpm db:migrate
pnpm dev                            # http://localhost:3333
pnpm seed:demo                      # fetch demo handles once (X credits)
pnpm simulate                       # build the read-only simulated showcase (~$1 of OpenAI)
pnpm test                           # unit tests (no network)
pnpm eval:judge                     # judge eval (real API calls)
```
