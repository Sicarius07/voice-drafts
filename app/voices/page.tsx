import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AddVoice } from "@/components/add-voice";
import { AppHeader } from "@/components/app-header";
import { HandleAvatar } from "@/components/handle-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel, Sheet } from "@/components/workspace/surfaces";
import { requireUser } from "@/server/auth";
import { loadVoicesPage } from "@/server/services/workspace";

async function Voices() {
  const user = await requireUser();
  const { voices, demos, showcaseId } = await loadVoicesPage(user.id);
  return (
    <Sheet className="space-y-6 p-3 sm:p-6">
      <div className="px-3 pt-3 sm:px-6 sm:pt-4">
        <AddVoice demos={demos} />
      </div>
      <Panel title="Your voices">
        {voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No voices yet. Add your handle above, or try a demo voice.</p>
        ) : (
          <ul className="space-y-2">
            {voices.map((v) => (
              <li key={v.id}>
                <Link href={`/voices/${v.id}`} className="flex items-center gap-3 rounded-xl bg-card p-3 transition-colors hover:bg-muted/60">
                  <HandleAvatar name={v.name} src={v.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{v.name}</p>
                    <p className="text-sm text-muted-foreground">
                      @{v.username} · {v.posts} posts
                    </p>
                  </div>
                  <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {showcaseId && (
        <p className="px-3 pb-2 text-sm text-muted-foreground sm:px-6">
          Curious how learning plays out over many rounds?{" "}
          <Link className="underline underline-offset-4" href={`/voices/${showcaseId}`}>
            See a voice after 14 rounds of feedback
          </Link>
          .
        </p>
      )}
    </Sheet>
  );
}

export default function VoicesPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-[1.75rem]" />}>
          <Voices />
        </Suspense>
      </main>
    </>
  );
}
