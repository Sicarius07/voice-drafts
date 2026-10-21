import Link from "next/link";
import { Suspense } from "react";
import { AddVoice } from "@/components/add-voice";
import { AppHeader } from "@/components/app-header";
import { HandleAvatar } from "@/components/handle-avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth";
import { loadVoicesPage } from "@/server/services/workspace";

async function Voices() {
  const user = await requireUser();
  const { voices, demos, showcaseId } = await loadVoicesPage(user.id);
  return (
    <div className="space-y-10">
      <AddVoice demos={demos} />
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Your voices</h2>
        {voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No voices yet. Add your handle above, or try a demo voice.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {voices.map((v) => (
              <li key={v.id}>
                <Link href={`/voices/${v.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                  <HandleAvatar name={v.name} src={v.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{v.name}</p>
                    <p className="text-sm text-muted-foreground">
                      @{v.username} · {v.posts} posts
                    </p>
                  </div>
                  {v.isDemo && <Badge variant="outline">demo</Badge>}
                  <Badge variant="secondary">{v.confidence} confidence</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showcaseId && (
        <p className="text-sm text-muted-foreground">
          Curious how learning plays out over many rounds?{" "}
          <Link className="underline underline-offset-4" href={`/voices/${showcaseId}`}>
            See a simulated 8-round run
          </Link>{" "}
          (scripted feedback, clearly labelled).
        </p>
      )}
    </div>
  );
}

export default function VoicesPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <Voices />
        </Suspense>
      </main>
    </>
  );
}
