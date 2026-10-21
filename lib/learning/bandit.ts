import type { FormulaId } from "@/lib/angles";

export type Posterior = { alpha: number; beta: number };
export const PRIOR: Posterior = { alpha: 1, beta: 1 };
type Rng = () => number;

function normal(rng: Rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/** Gamma(shape, 1) sample (Marsaglia–Tsang). */
function gamma(shape: number, rng: Rng): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng);
    const v = (1 + c * x) ** 3;
    if (v > 0 && Math.log(1 - rng()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

export const sampleBeta = ({ alpha, beta }: Posterior, rng: Rng = Math.random) => {
  const x = gamma(alpha, rng);
  return x / (x + gamma(beta, rng));
};

/**
 * Thompson sampling: draw from each angle's posterior and take the top `n` distinct angles. When the goal has
 * fewer angles than drafts, `fallback` angles (other goals) fill the rest, so a batch doesn't repeat one shape.
 */
export function pickAngles(
  posteriors: Partial<Record<FormulaId, Posterior>>,
  eligible: FormulaId[],
  n: number,
  { fallback = [], rng = Math.random }: { fallback?: FormulaId[]; rng?: Rng } = {},
): FormulaId[] {
  const rank = (ids: FormulaId[]) =>
    ids
      .map((id) => ({ id, draw: sampleBeta(posteriors[id] ?? PRIOR, rng) }))
      .sort((a, b) => b.draw - a.draw)
      .map((x) => x.id);
  const ranked = [...rank(eligible), ...rank(fallback.filter((id) => !eligible.includes(id)))];
  return Array.from({ length: n }, (_, i) => ranked[i % ranked.length]);
}

/** Fractional Beta update: reward r in [0,1], weighted by how much we trust the signal. */
export const updatePosterior = (p: Posterior, r: number, weight = 1): Posterior => ({
  alpha: p.alpha + weight * r,
  beta: p.beta + weight * (1 - r),
});

export const posteriorMean = (p: Posterior) => p.alpha / (p.alpha + p.beta);
