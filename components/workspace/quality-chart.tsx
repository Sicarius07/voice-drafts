"use client";

import { CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis, type LabelProps } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { QualityPoint } from "@/lib/learning/metrics";

// Same unit (% of drafts / % of words), so one shared 0–100 axis. Colors: validated palette slots 1–2.
const config = {
  acceptance: { label: "Accepted drafts", color: "var(--series-1)" },
  burden: { label: "Words you changed", color: "var(--series-2)" },
} satisfies ChartConfig;

const pct = (x: number | null) => (x === null ? null : Math.round(x * 100));

export function QualityChart({ series }: { series: QualityPoint[] }) {
  if (series.length < 2)
    return <p className="text-sm text-muted-foreground">The chart appears after two batches. Accept, edit or reject a few drafts to give it data.</p>;
  const data = series.map((p) => ({ batch: p.batch, acceptance: pct(p.acceptance), burden: pct(p.burden) }));
  const last = data.length - 1;
  const endLabel = (key: keyof typeof config) =>
    function EndLabel(props: LabelProps) {
      if (props.index !== last || props.value == null) return null;
      return (
        <text x={Number(props.x) + 8} y={Number(props.y)} dy={4} className="fill-foreground text-[11px]">
          {config[key].label.split(" ")[0]} {props.value}%
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
              dot={{ r: 4, fill: `var(--color-${key})`, stroke: "var(--background)", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            >
              <LabelList dataKey={key} content={endLabel(key)} />
            </Line>
          ))}
        </LineChart>
      </ChartContainer>
      <figcaption className="text-xs text-muted-foreground">
        Rolling 3-batch means. Accepted = copied, liked or picked; up is better. Words changed = share of words you change in the drafts you use (used as-is = 0%); down is better. Users change over time
        too, so the blind A/B test is the cleaner evidence.
      </figcaption>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Show data</summary>
        <table className="mt-2 w-full max-w-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Batch</th>
              <th className="font-medium">Accepted</th>
              <th className="font-medium">Words changed</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.batch}>
                <td>{d.batch}</td>
                <td>{d.acceptance}%</td>
                <td>{d.burden === null ? "–" : `${d.burden}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
