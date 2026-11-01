/**
 * Sell-through by item (BR-53, decision D124): what an account that holds stock sold through in a
 * month, from its stock statement. Quantities are decimal strings at three places, money at two,
 * worked out exactly; dates are `YYYY-MM-DD` and months `YYYY-MM` on the tenant's clock. Templates
 * give the record its word, such as liquidation.
 */
import { scaled, unscaled } from './pricing';

/** Days into the next month during which a month's statement may still change. */
export const SELL_THROUGH_GRACE_DAYS = 5;

export const SELL_THROUGH_FLAGS = ['negative_sold', 'opening_changed', 'no_price'] as const;
export type SellThroughFlag = (typeof SELL_THROUGH_FLAGS)[number];

/** One item's stock for a month, in its base unit. */
export interface StockLine {
  opening: string;
  received: string;
  returned: string;
  closing: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** A signed integer at `places` as a decimal string. */
function signed(value: bigint, places: number): string {
  return value < 0n ? `-${unscaled(-value, places)}` : unscaled(value, places);
}

/** BR-53: sold through = opening + received − returned − closing; negative when stock grew. */
export function soldThrough(line: StockLine): string {
  const [opening, received, returned, closing] = [
    line.opening,
    line.received,
    line.returned,
    line.closing,
  ].map((value) => scaled(value, 3)) as [bigint, bigint, bigint, bigint];
  return signed(opening + received - returned - closing, 3);
}

/**
 * BR-53's flags on a line, never refusals: sold through below nothing, and an opening that isn't
 * last month's closing carried forward (`carried` null when there was none).
 */
export function statementLineFlags(line: StockLine, carried: string | null): SellThroughFlag[] {
  const flags: SellThroughFlag[] = [];
  if (soldThrough(line).startsWith('-')) flags.push('negative_sold');
  if (carried !== null && scaled(carried, 3) !== scaled(line.opening, 3)) {
    flags.push('opening_changed');
  }
  return flags;
}

/** The last day of a month. */
export function monthEnd(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return dateOf(Date.UTC(year, month, 1) / DAY_MS - 1);
}

/**
 * BR-53: a month's statement may change while the month runs and for the first
 * `SELL_THROUGH_GRACE_DAYS` days after it, and not before it starts.
 */
export function statementOpen(period: string, today: string): boolean {
  const first = `${period}-01`;
  const last = dateOf(dayNumber(monthEnd(period)) + SELL_THROUGH_GRACE_DAYS);
  return today >= first && today <= last;
}

/**
 * BR-53: the day a month's statement counts on, for whoever saved its latest version: the day it
 * was saved, or the month's last day for a change made in the days after (BR-03 for a month).
 */
export function creditedDate(period: string, savedOn: string): string {
  const last = monthEnd(period);
  return savedOn < last ? savedOn : last;
}

/** A line's value: sold through at its unit price, rounded half away from zero to the paisa. */
export function lineValue(sold: string, unitPrice: string | null): string | null {
  if (unitPrice === null) return null;
  const product = scaled(sold.replace(/^-/, ''), 3) * scaled(unitPrice, 2);
  // Three and two places make five; back to two, rounding half up on the size.
  const rounded = (product + 500n) / 1000n;
  return signed(sold.startsWith('-') ? -rounded : rounded, 2);
}
