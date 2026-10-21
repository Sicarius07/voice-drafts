# Voice Drafts

Drafts for X in your own voice, from a tool that learns from every edit you make.

**Live:** https://voice-drafts-flax.vercel.app

**Try it:** sign in → enter your X handle (it reads your ~200 latest original posts once and builds your voice) →
Generate → edit one draft and save → watch the "New tentative rule" toast → Generate again → **Compare with/without
learning** and pick blind. To see a voice after 12 rounds of feedback, open the @okara_eng link on the voices page.

```
handle ─▶ X API (once, cached) ─▶ stats (code) + qualities (LLM, verified by code) ─▶ voice profile
notes + goal ─▶ angle bandit ─▶ examples ─▶ generate ─▶ checks (code) ─▶ AI-tell judge (LLM, spans verified by code)
draft card: voice match + AI tells ─▶ copy / edit / 👍👎 / pick ─▶ edit ─▶ rule (LLM, verified by code) ─▶ next batch
```


## Decisions and why

| Area | Decision | Why |
|---|---|---|
| Tweet data | Official X API | X reads are the main cost |
| Voice profile | Stats by code (length, casing, punctuation, emoji…) + qualities by the LLM | Unverifiable claims are dropped |
| Two meters | **Voice match**: how typical a draft is of you, as a percentile against your own posts. **AI tells**: Clean / Minor / Needs work, with each phrase highlighted and explained. | AI detectors are unreliable on short text; named phrases are actionable |
| No invented facts | Numbers, names and links come only from your notes; otherwise a placeholder like `[your number]` with a hint, filled in place on the card. | You review every draft; nothing is ever posted for you. |
| Images and video | Skipped: drafts are text only. Posts whose text only makes sense with their image are left out of the examples. | Media that fits both the person (their visual style, what they'd actually share) and the specific draft is a hard problem of its own; a generic image reads as AI. A good problem to solve next |
| Angles | Hook formulas from x-skills, picked per voice by a Thompson-sampling bandit | learns which shapes you keep |




**Not built:** per-user quotas, embeddings for example selection, threads, learning from real post engagement.

**Security:** keys and LLM calls are server-only; the X token can't post. Fetched posts are treated as untrusted data in
every prompt. No email verification (no mail service); Better Auth won't link an OAuth sign-in into an unverified account.


## Local setup

```bash
pnpm install
cp .env.example .env.local   # keys; DATABASE_URL can be a local Postgres
pnpm db:migrate
pnpm dev                     # http://localhost:3333
pnpm seed:demo               # fetch demo handles once (X credits)
pnpm test                    # unit tests
```

