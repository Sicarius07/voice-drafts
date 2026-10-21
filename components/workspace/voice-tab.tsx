import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import type { Workspace } from "@/server/services/workspace";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const Chips = ({ items }: { items: string[] }) => (
  <div className="flex flex-wrap gap-1">
    {items.map((x) => (
      <Badge key={x} variant="secondary" className="font-normal">
        {x}
      </Badge>
    ))}
  </div>
);

export function VoiceTab({ data }: { data: Workspace }) {
  const { stats: s, qualities: q } = data.profile;
  const r = s.rates;
  const facts: [string, string][] = [
    ["Typical length", `${Math.round(s.length.p10)}–${Math.round(s.length.p90)} chars (median ${Math.round(s.length.p50)})`],
    ["Starts lowercase", pct(r.lowercaseStart)],
    ["No final punctuation", pct(r.noTerminalPunct)],
    ["Multi-line", pct(r.multiLine)],
    ["Emoji", `${pct(r.hasEmoji)}${s.topEmoji.length ? ` · ${s.topEmoji.join(" ")}` : ""}`],
    ["Hashtags", pct(r.hasHashtag)],
    ["Links", pct(r.link)],
    ["Em dashes", pct(r.hasEmDash)],
    ["Ends on a question", pct(r.questionEnd)],
    ["Numbers", pct(r.digits)],
    ["Quote posts", pct(s.quoteRate)],
  ];
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Profile v{data.profile.version} · built from {s.n} {data.profile.fromPaste ? "pasted" : "original"} posts
          {s.span && (
            <>
              {" "}
              (<LocalTime iso={s.span.from} dateOnly />–<LocalTime iso={s.span.to} dateOnly />)
            </>
          )} · <strong>{s.confidence} confidence</strong>
          {data.profile.droppedClaims > 0 && ` · ${data.profile.droppedClaims} unverifiable claim(s) dropped`}
        </p>
        {s.confidence === "low" && <p className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">Low confidence: this is a first pass. More posts make the profile sharper.</p>}
        <Block title="Who you are (inferred)">
          <p className="text-sm">{q.persona}</p>
          <p className="text-sm text-muted-foreground">Writing for: {q.audience}</p>
        </Block>
        <Block title="Topics">
          <Chips items={q.topics.map((t) => `${t.label} · ${t.count}`)} />
        </Block>
        {q.tone.length > 0 && (
          <Block title="Tone">
            <Chips items={q.tone} />
          </Block>
        )}
        {q.positions.length > 0 && (
          <Block title="Positions you keep coming back to">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {q.positions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Block>
        )}
        {[...q.phrases, ...q.openers, ...q.closers].length > 0 && (
          <Block title="Phrases, openers and closers (counted in your posts)">
            <Chips items={[...q.phrases, ...q.openers, ...q.closers].map((p) => `“${p.text}” ${p.count}×`)} />
          </Block>
        )}
        {q.neverUses.length > 0 && (
          <Block title="Words you never use">
            <Chips items={q.neverUses} />
          </Block>
        )}
      </div>
      <div className="space-y-6">
        <Block title="Style, measured by code">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Block>
        <Block title="Habits I won't flag as AI tells">
          {data.profile.habits.length ? <Chips items={data.profile.habits} /> : <p className="text-sm text-muted-foreground">None common enough (10%+ of posts).</p>}
        </Block>
        <Block title="Signature posts (quoted verbatim)">
          <ul className="space-y-2">
            {data.profile.signatures.map((t, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
                {t}
              </li>
            ))}
          </ul>
        </Block>
      </div>
    </div>
  );
}
