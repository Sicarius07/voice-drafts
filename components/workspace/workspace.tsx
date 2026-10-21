"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Tabs } from "radix-ui";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { HandleAvatar } from "@/components/handle-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { postStream } from "@/lib/ndjson-client";
import type { Workspace as Data } from "@/server/services/workspace";
import { BatchView } from "./batch-list";
import { Composer } from "./composer";
import { LearningTab } from "./learning-tab";
import { Sheet, TAB_ICONS, WORKSPACE_WIDTH } from "./surfaces";
import { useBatches } from "./use-batches";
import { VoiceTab } from "./voice-tab";

const WIDE = "(min-width: 64rem)";
const onWideChange = (cb: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** CSS lays the rail out; this only keeps arrow keys and aria-orientation in step with it. */
const useWide = () => useSyncExternalStore(onWideChange, () => matchMedia(WIDE).matches, () => true);

const NAV = [
  { value: "drafts", label: "Drafts", Icon: TAB_ICONS.drafts },
  { value: "voice", label: "Voice", Icon: TAB_ICONS.voice },
  { value: "learning", label: "Learning", Icon: TAB_ICONS.learning },
] as const;

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
  const wide = useWide();

  return (
    <>
      <AppHeader className={WORKSPACE_WIDTH}>
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
      <main className={`mx-auto w-full ${WORKSPACE_WIDTH} space-y-5 px-4 py-6`}>
        <Tabs.Root defaultValue={voice.isShowcase ? "learning" : "drafts"} orientation={wide ? "vertical" : "horizontal"} className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
          <Tabs.List
            aria-label="Workspace"
            className="flex w-fit gap-1 self-start rounded-full bg-background/60 p-1 shadow-ornament ring-1 ring-border/70 backdrop-blur-xl backdrop-saturate-150 lg:sticky lg:top-14 lg:flex-col lg:rounded-[1.75rem] lg:p-1.5"
          >
            {NAV.map(({ value, label, Icon }) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="relative flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm lg:h-auto lg:w-16 lg:flex-col lg:gap-1 lg:rounded-[1.25rem] lg:px-0 lg:py-2.5 lg:text-[11px]"
              >
                <Icon aria-hidden className="size-4 lg:size-5" />
                {label}
                {value === "learning" && liveRules > 0 && (
                  <span className="ml-0.5 rounded-full bg-foreground px-1.5 text-[10px] leading-4 text-background tabular-nums lg:absolute lg:top-1.5 lg:right-2.5 lg:ml-0">
                    {liveRules}
                    <span className="sr-only"> rules</span>
                  </span>
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="min-w-0 flex-1">
            <Tabs.Content value="drafts" className="outline-none">
              <Sheet className="space-y-8 p-3 sm:p-6">
                {!voice.readOnly && <Composer topics={profile.qualities.topics.map((t) => t.label)} canCompare={liveRules > 0} busy={ctl.busy} onGenerate={ctl.generate} />}
                {ctl.batches.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No drafts yet. Add a few notes (or none) and hit Generate.</p>
                ) : (
                  ctl.batches.map((b) => <BatchView key={b.id} batch={b} author={author} readOnly={voice.readOnly} ctl={ctl} />)
                )}
              </Sheet>
            </Tabs.Content>
            <Tabs.Content value="voice" className="pt-5 outline-none">
              <VoiceTab data={data} />
            </Tabs.Content>
            <Tabs.Content value="learning" className="outline-none">
              <LearningTab data={data} />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </main>
    </>
  );
}
