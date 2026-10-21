/** Wilson score interval for k successes in n trials (95% by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

export type BatchOutcome = { shown: number; accepted: number; burdens: number[] };
export type QualityPoint = { batch: number; acceptance: number; kept: number | null };

/** Acceptance rate and words kept (1 − edit burden) per batch, as rolling means over `window` batches. */
export function qualitySeries(batches: BatchOutcome[], window = 3): QualityPoint[] {
  return batches.map((_, i) => {
    const w = batches.slice(Math.max(0, i - window + 1), i + 1);
    const shown = w.reduce((s, b) => s + b.shown, 0);
    const burdens = w.flatMap((b) => b.burdens);
    return {
      batch: i + 1,
      acceptance: shown ? w.reduce((s, b) => s + b.accepted, 0) / shown : 0,
      kept: burdens.length ? 1 - burdens.reduce((a, b) => a + b, 0) / burdens.length : null,
    };
  });
}

export type AbTally = { learned: number; baseline: number; tie: number; neither: number; decided: number; rate: number | null; ci: [number, number] | null };

export function abTally(winners: string[]): AbTally {
  const count = (w: string) => winners.filter((x) => x === w).length;
  const learned = count("learned");
  const baseline = count("baseline");
  const decided = learned + baseline;
  return {
    learned,
    baseline,
    tie: count("tie"),
    neither: count("neither"),
    decided,
    rate: decided ? learned / decided : null,
    ci: decided ? wilson(learned, decided) : null,
  };
}
