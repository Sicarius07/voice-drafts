import Link from "next/link";
import { Suspense } from "react";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { getUser } from "@/server/auth";

async function Cta() {
  const user = await getUser();
  if (user)
    return (
      <Button asChild size="lg">
        <Link href="/voices">Open your voices</Link>
      </Button>
    );
  return <SignIn github={!!process.env.GITHUB_CLIENT_ID} devLogin={process.env.NODE_ENV !== "production"} />;
}

const STEPS = [
  ["Your voice, measured", "We read your recent posts once. Code measures your style; an LLM describes your voice, and every claim it makes is checked against your posts."],
  ["Drafts with two honest meters", "Voice match: how typical a draft is of you. AI tells: specific phrases readers spot, each one verified in the text and calibrated to habits you actually have."],
  ["It learns from your edits", "Edit a draft and the change becomes a rule you can see, edit or undo. A blind A/B test shows whether the learning actually helps."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 px-4 py-16">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Voice Drafts</p>
        <h1 className="text-4xl font-semibold tracking-tight">Drafts for X that sound like you, and get better every time you edit one.</h1>
        <p className="text-muted-foreground">Nothing is ever posted for you. Facts come only from your notes; anything missing becomes a placeholder like [your number].</p>
      </div>
      <Suspense fallback={<div className="h-9" />}>
        <Cta />
      </Suspense>
      <ol className="grid gap-6 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="space-y-1">
            <p className="font-mono text-xs text-muted-foreground">0{i + 1}</p>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
