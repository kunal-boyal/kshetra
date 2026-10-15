/**
 * Performance rules (spec 5.8, M9): attainment, the score (BR-06) and ranks (BR-07). Values are
 * plain numbers here: they come from summed `numeric` facts and only ever feed percentages.
 */

export type MetricDirection = 'higher_is_better' | 'lower_is_better';

/**
 * How much of a target an actual meets: `a / t`, or `t / a` when lower is better, where an actual
 * of 0 meets it in full (BR-06). Null without a target above zero, or without an actual.
 */
export function attainment(
  actual: number | null,
  target: number | null,
  direction: MetricDirection,
): number | null {
  if (actual === null || target === null || !(target > 0)) return null;
  if (direction === 'lower_is_better') return actual <= 0 ? 1 : target / actual;
  return actual / target;
}

export interface ScoredMetric {
  key: string;
  weight: number;
  direction: MetricDirection;
  actual: number | null;
  target: number | null;
}

export interface ScoreInput {
  /** Whether the person's target set for the period is locked. */
  locked: boolean;
  /** The highest attainment one metric contributes: 1 is 100%. */
  cap: number;
  metrics: readonly ScoredMetric[];
}

/**
 * BR-06: `round(100 × Σ wᵢ × min(aᵢ / tᵢ, c) / Σ wᵢ)`. A score exists only when the target set is
 * locked and every scored metric has a target above zero; otherwise the person isn't ranked, and
 * is never given a score of zero.
 */
export function scoreOf(input: ScoreInput): number | null {
  if (!input.locked || input.metrics.length === 0) return null;
  let weighted = 0;
  let weights = 0;
  for (const metric of input.metrics) {
    if (metric.target === null || !(metric.target > 0)) return null;
    const ratio = attainment(metric.actual ?? 0, metric.target, metric.direction) ?? 0;
    weighted += metric.weight * Math.min(ratio, input.cap);
    weights += metric.weight;
  }
  return weights > 0 ? Math.round((100 * weighted) / weights) : null;
}

export interface RankedRow<T> {
  row: T;
  rank: number | null;
}

/**
 * BR-07: ranks by score, highest first. Equal scores share the higher rank and the next rank
 * skips (1, 1, 3). People without a score come last, without a rank, in the order given.
 */
export function rankByScore<T extends { score: number | null }>(
  rows: readonly T[],
): RankedRow<T>[] {
  const scored = rows
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number));
  const ranked: RankedRow<T>[] = [];
  scored.forEach((row, index) => {
    const previous = ranked[index - 1];
    const rank = previous && previous.row.score === row.score ? previous.rank : index + 1;
    ranked.push({ row, rank });
  });
  for (const row of rows) if (row.score === null) ranked.push({ row, rank: null });
  return ranked;
}

/**
 * BR-04: a ratio from summed parts, never an average of ratios; times 100 for percentages. Null
 * when there is nothing to divide by.
 */
export function ratioOf(numerator: number, denominator: number, percent = false): number | null {
  if (!(denominator > 0)) return null;
  return (numerator / denominator) * (percent ? 100 : 1);
}

/** The first and last dates of a `YYYY-MM` month. */
export function monthDates(period: string): { from: string; to: string } {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/** The `YYYY-MM` month a date falls in. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}
