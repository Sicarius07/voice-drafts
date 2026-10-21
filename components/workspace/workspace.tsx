"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { HandleAvatar } from "@/components/handle-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postStream } from "@/lib/ndjson-client";
import type { Workspace as Data } from "@/server/services/workspace";
import { BatchView } from "./batch-list";
import { Composer } from "./composer";
import { LearningTab } from "./learning-tab";
import { useBatches } from "./use-batches";
import { VoiceTab } from "./voice-tab";

function RefreshButton({ voiceId }: { voiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    const id = toast.loading("Fetching new posts…");
    await postStream(`/api/voices/${voiceId}/refresh`, {}, (e) => {
      if (e.type === "progress") toast.loading(e.step, { id });
      if (e.type === "error") toast.error(e.message, { id });
      if (e.type === "done") toast.success("Up to date.", { id });
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
      {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Refresh
    </Button>
  );
}

export function Workspace({ data }: { data: Data }) {
  const ctl = useBatches(data.voice.id, data.batches);
  const { account, voice, profile } = data;
  const author = { name: account.name, username: account.username, avatarUrl: account.avatarUrl };
  const liveRules = data.rules.filter((r) => r.status !== "archived").length;

  return (
    <>
      <AppHeader>
        <HandleAvatar name={account.name} src={account.avatarUrl} className="size-7" />
        <span className="truncate text-sm font-medium">{account.name}</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">@{account.username}</span>
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {profile.stats.confidence} confidence
        </Badge>
        {account.isDemo && <Badge variant="outline">demo · not affiliated</Badge>}
        {account.fromApi && !account.isDemo && !voice.readOnly && (
          <span className="ml-auto flex items-center gap-1">
            {account.stale && <span className="text-xs text-warning">stale</span>}
            <RefreshButton voiceId={voice.id} />
          </span>
        )}
      </AppHeader>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
        {voice.isShowcase && (
          <p className="rounded-lg border border-dashed p-3 text-sm">
            <strong>Simulated run, read-only.</strong> A scripted user with hidden preferences generated, edited and rated these drafts so you can see the learning loop
            over 8 rounds. Real voices start empty.
          </p>
        )}
        <Tabs defaultValue={voice.isShowcase ? "learning" : "drafts"}>
          <TabsList>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="learning">
              Learning
              {liveRules > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5">
                  {liveRules}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="drafts" className="space-y-8 pt-4">
            {!voice.readOnly && <Composer topics={profile.qualities.topics.map((t) => t.label)} canCompare={liveRules > 0} busy={ctl.busy} onGenerate={ctl.generate} />}
            {ctl.batches.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No drafts yet. Add a few notes (or none) and hit Generate.</p>
            ) : (
              ctl.batches.map((b) => <BatchView key={b.id} batch={b} author={author} readOnly={voice.readOnly} ctl={ctl} />)
            )}
          </TabsContent>
          <TabsContent value="voice" className="pt-4">
            <VoiceTab data={data} />
          </TabsContent>
          <TabsContent value="learning" className="pt-4">
            <LearningTab data={data} />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
