/**
 * Product forecasts per account (BR-54, decision D126): each account's expected quantity by item
 * for the coming months, locked as each month begins, and how close it came. Quantities are
 * decimal strings at three places, worked out exactly; months are `YYYY-MM` on the tenant's clock.
 */
import { shiftPeriod } from './periods';
import { scaled, unscaled } from './pricing';

/** How many months ahead a forecast is kept, after the month under way. */
export const FORECAST_MONTHS = 3;

/** BR-54: the months a forecast is made for: the three after today's. */
export function forecastMonths(today: string): string[] {
  const month = today.slice(0, 7);
  return Array.from({ length: FORECAST_MONTHS }, (_, index) => shiftPeriod(month, index + 1));
}

/**
 * BR-54: whether a month's forecast may change. Before the month starts, by anyone who records
 * forecasts; from its 1st, only with the override (`forecast.adjust`), and then with a reason.
 */
export function forecastOpen(period: string, today: string, override: boolean): boolean {
  return today.slice(0, 7) < period || override;
}

/** Whether a change to this month comes after its lock, so it needs a reason (BR-54). */
export function forecastAfterLock(period: string, today: string): boolean {
  return today.slice(0, 7) >= period;
}

export interface ForecastLine {
  forecast: string;
  actual: string;
}

/**
 * BR-54: weighted accuracy, 1 − Σ|actual − forecast| ÷ Σforecast, never below 0, as a fraction
 * rounded to four places; null when nothing was forecast, so no forecast never reads as perfect.
 */
export function forecastAccuracy(lines: readonly ForecastLine[]): number | null {
  let forecast = 0n;
  let missed = 0n;
  for (const line of lines) {
    const planned = scaled(line.forecast, 3);
    const actual = scaled(line.actual, 3);
    forecast += planned;
    missed += planned > actual ? planned - actual : actual - planned;
  }
  if (forecast === 0n) return null;
  if (missed >= forecast) return 0;
  // Four places, rounded half up.
  const share = ((forecast - missed) * 20_000n + forecast) / (forecast * 2n);
  return Number(share) / 10_000;
}

/** BR-54: actual less forecast, signed, and as a share of the forecast (null without one). */
export function forecastGap(
  forecast: string,
  actual: string,
): { quantity: string; share: number | null } {
  const planned = scaled(forecast, 3);
  const gap = scaled(actual, 3) - planned;
  const quantity = gap < 0n ? `-${unscaled(-gap, 3)}` : unscaled(gap, 3);
  return { quantity, share: planned === 0n ? null : Number((gap * 10_000n) / planned) / 10_000 };
}
