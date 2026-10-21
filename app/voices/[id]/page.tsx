import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WORKSPACE_WIDTH } from "@/components/workspace/surfaces";
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
      <AppHeader className={WORKSPACE_WIDTH} />
      <main className={`mx-auto flex w-full ${WORKSPACE_WIDTH} flex-col gap-5 px-4 py-6 lg:flex-row lg:gap-6`}>
        <Skeleton className="h-10 w-64 rounded-full lg:h-52 lg:w-[4.75rem] lg:rounded-[1.75rem]" />
        <Skeleton className="h-[28rem] min-w-0 flex-1 rounded-[1.75rem]" />
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
