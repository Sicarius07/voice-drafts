import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Workspace } from "@/components/workspace/workspace";
import { requireUser } from "@/server/auth";
import { UserError } from "@/server/services/context";
import { loadWorkspace } from "@/server/services/workspace";

async function WorkspaceLoader({ params }: { params: PageProps<"/voices/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await loadWorkspace(id, user.id).catch((err) => {
    if (err instanceof UserError) notFound();
    throw err;
  });
  return <Workspace data={data} />;
}

function WorkspaceSkeleton() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    </>
  );
}

export default function VoicePage({ params }: PageProps<"/voices/[id]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <WorkspaceLoader params={params} />
    </Suspense>
  );
}
