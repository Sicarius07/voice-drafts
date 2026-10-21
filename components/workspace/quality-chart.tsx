"use client";

import { CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis, type LabelProps } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { QualityPoint } from "@/lib/learning/metrics";

// Same unit (% of drafts / % of words), so one shared 0–100 axis. Colors: validated palette slots 1–2.
const config = {
  acceptance: { label: "Accepted drafts", color: "var(--series-1)" },
  kept: { label: "Words kept", color: "var(--series-2)" },
} satisfies ChartConfig;
const SHORT = { acceptance: "Accepted", kept: "Kept" };

const pct = (x: number | null) => (x === null ? null : Math.round(x * 100));

export function QualityChart({ series }: { series: QualityPoint[] }) {
  if (series.length < 2)
    return <p className="text-sm text-muted-foreground">The chart appears after two batches. Accept, edit or reject a few drafts to give it data.</p>;
  const data = series.map((p) => ({ batch: p.batch, acceptance: pct(p.acceptance), kept: pct(p.kept) }));
  const last = data.length - 1;
  // Lines that end close together get their end labels nudged apart so the labels don't overlap.
  const [a, b] = [data[last].acceptance, data[last].kept];
  const close = a !== null && b !== null && Math.abs(a - b) < 12;
  const dy = { acceptance: close ? (a >= b ? -6 : 14) : 4, kept: close ? (a >= b ? 14 : -6) : 4 };
  const endLabel = (key: keyof typeof config) =>
    function EndLabel(props: LabelProps) {
      if (props.index !== last || props.value == null) return null;
      return (
        <text x={Number(props.x) + 8} y={Number(props.y)} dy={dy[key]} className="fill-foreground text-[11px]">
          {SHORT[key]} {props.value}%
        </text>
      );
    };
  return (
    <figure className="space-y-2">
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart data={data} margin={{ top: 8, right: 88, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="batch" tickLine={false} axisLine={false} tickMargin={8} label={{ value: "batch", position: "insideBottomRight", offset: -2, className: "fill-muted-foreground text-[11px]" }} />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Batch ${p?.[0]?.payload?.batch}`} formatter={(v, name) => `${config[name as keyof typeof config].label}: ${v}%`} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {(Object.keys(config) as (keyof typeof config)[]).map((key) => (
            <Line
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              strokeLinecap="round"
              connectNulls
              dot={{ r: 4, fill: `var(--color-${key})`, stroke: "var(--platter)", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            >
              <LabelList dataKey={key} content={endLabel(key)} />
            </Line>
          ))}
        </LineChart>
      </ChartContainer>
      <figcaption className="text-xs text-muted-foreground">
        Rolling 3-batch means; up is better for both. Accepted = copied, liked or picked. Words kept = share of each draft&apos;s words you kept in the drafts you use (used as-is =
        100%). Users change over time too, so the blind A/B test is the cleaner evidence.
      </figcaption>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Show data</summary>
        <table className="mt-2 w-full max-w-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Batch</th>
              <th className="font-medium">Accepted</th>
              <th className="font-medium">Words kept</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.batch}>
                <td>{d.batch}</td>
                <td>{d.acceptance}%</td>
                <td>{d.kept === null ? "–" : `${d.kept}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
