import Link from "next/link";
import { Suspense } from "react";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Panel, Sheet, TAB_ICONS } from "@/components/workspace/surfaces";
import { getUser, OAUTH_PROVIDERS } from "@/server/auth";

async function Cta() {
  const user = await getUser();
  if (user)
    return (
      <Button asChild size="lg">
        <Link href="/voices">Open your voices</Link>
      </Button>
    );
  return <SignIn providers={OAUTH_PROVIDERS} />;
}

// The loop in the order it happens, each named after the workspace tab where it lives.
const STEPS = [
  ["voice", "Voice", "Your voice, measured", "We read your recent posts once. Code measures your style; an LLM describes your voice, and every claim it makes is checked against your posts."],
  ["drafts", "Drafts", "Drafts with two honest meters", "Voice match: how typical a draft is of you. AI tells: specific phrases readers spot, each one verified in the text and calibrated to habits you actually have."],
  ["learning", "Learning", "It learns from your edits", "Edit a draft and the change becomes a rule you can see, edit or undo. A blind A/B test shows whether the learning actually helps."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-5 px-4 py-12 sm:py-16">
      <p className="px-1 text-sm font-semibold">Voice Drafts</p>
      <Sheet className="space-y-8 p-3 sm:space-y-10 sm:p-6">
        <div className="space-y-8 px-3 pt-5 sm:px-6 sm:pt-6">
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl/[1.05]">Drafts for X that sound like you, and get better every time you edit one.</h1>
            <p className="max-w-[60ch] text-muted-foreground">Nothing is ever posted for you. Facts come only from your notes; anything missing becomes a placeholder like [your number].</p>
          </div>
          <Suspense fallback={<div className="h-10" />}>
            <Cta />
          </Suspense>
        </div>
        <Panel>
          <ol className="grid gap-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
            {STEPS.map(([tab, name, title, body]) => {
              const Icon = TAB_ICONS[tab];
              return (
                <li key={tab} className="space-y-2 sm:px-6 sm:first:pl-0 sm:last:pr-0">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon aria-hidden className="size-3.5" />
                    {name}
                  </p>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm/relaxed text-muted-foreground">{body}</p>
                </li>
              );
            })}
          </ol>
        </Panel>
      </Sheet>
    </main>
  );
}
