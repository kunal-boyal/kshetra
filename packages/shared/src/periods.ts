/**
 * Target and score periods (spec 5.8, decision D108): a month (`2026-10`), a quarter of the
 * financial year (`FY2026-Q3`: the third quarter of the year that starts in 2026) or the
 * financial year (`FY2026`). Quarters and years count from the tenant's
 * `financialYearStartMonth`, so a key's dates depend on it; a month's never do.
 */

export const TARGET_PERIOD_KINDS = ['month', 'quarter', 'year'] as const;
export type TargetPeriodKind = (typeof TARGET_PERIOD_KINDS)[number];

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^FY(\d{4})-Q([1-4])$/;
const YEAR = /^FY(\d{4})$/;

/** Whether a string is a period key of any kind. */
export function isPeriodKey(key: string): boolean {
  return MONTH.test(key) || QUARTER.test(key) || YEAR.test(key);
}

/** A key's kind; it throws for a string that is no key, which schemas refuse before. */
export function periodKind(key: string): TargetPeriodKind {
  if (MONTH.test(key)) return 'month';
  if (QUARTER.test(key)) return 'quarter';
  if (YEAR.test(key)) return 'year';
  throw new Error(`Not a period: ${key}`);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The first day of the month `months` after `year`-`month` (both 1-based), as `YYYY-MM-01`. */
function monthStart(year: number, month: number, months = 0): string {
  const at = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-01`;
}

/** The day before a `YYYY-MM-DD` date. */
function dayBefore(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

/** A key's first month (`year`, `month`) and how many months it spans. */
function span(key: string, startMonth: number): { year: number; month: number; months: number } {
  const month = MONTH.exec(key);
  if (month) return { year: Number(month[1]), month: Number(month[2]), months: 1 };
  const quarter = QUARTER.exec(key);
  if (quarter) {
    const first = monthStart(Number(quarter[1]), startMonth, (Number(quarter[2]) - 1) * 3);
    return { year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)), months: 3 };
  }
  const year = YEAR.exec(key);
  if (year) return { year: Number(year[1]), month: startMonth, months: 12 };
  throw new Error(`Not a period: ${key}`);
}

/** How many months a period spans: 1, 3 or 12. */
export function periodMonths(key: string): number {
  return span(key, 1).months;
}

/** A period's first and last dates, `YYYY-MM-DD`, with the tenant's financial year start. */
export function periodDates(key: string, startMonth: number): { from: string; to: string } {
  const { year, month, months } = span(key, startMonth);
  return { from: monthStart(year, month), to: dayBefore(monthStart(year, month, months)) };
}

/** The `YYYY-MM` months a period spans, in order. */
export function periodMonthKeys(key: string, startMonth: number): string[] {
  const { year, month, months } = span(key, startMonth);
  return Array.from({ length: months }, (_, index) => monthStart(year, month, index).slice(0, 7));
}

/** The period of a kind that a `YYYY-MM-DD` date falls in. */
export function periodOf(kind: TargetPeriodKind, date: string, startMonth: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (kind === 'month') return date.slice(0, 7);
  const startYear = month >= startMonth ? year : year - 1;
  if (kind === 'year') return `FY${startYear}`;
  const into = (month - startMonth + 12) % 12;
  return `FY${startYear}-Q${Math.floor(into / 3) + 1}`;
}

/** The period of the same kind `steps` after a key (before it when negative). */
export function shiftPeriod(key: string, steps: number): string {
  const kind = periodKind(key);
  if (kind === 'month') {
    const [year, month] = key.split('-').map(Number) as [number, number];
    return monthStart(year, month, steps).slice(0, 7);
  }
  if (kind === 'year') return `FY${Number(key.slice(2, 6)) + steps}`;
  const index = Number(key.slice(2, 6)) * 4 + Number(key.slice(-1)) - 1 + steps;
  return `FY${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

/** The period before a key, of the same kind. */
export const previousPeriod = (key: string) => shiftPeriod(key, -1);

/** The period after a key, of the same kind. */
export const nextPeriod = (key: string) => shiftPeriod(key, 1);

/** What the score definition says about periods (`ScoreDefinition` in `@thelamp/metrics`). */
export interface PeriodSetting {
  periodType: TargetPeriodKind;
  /** The first period of `periodType`; before it, `earlierPeriodType` applied. */
  periodFrom?: string | undefined;
  earlierPeriodType?: TargetPeriodKind | undefined;
}

/**
 * The kind of period in force on a date: the score's `periodType` from `periodFrom` on, the
 * earlier kind before it. Without a score definition, months (spec 5.8).
 */
export function periodKindOn(
  setting: PeriodSetting | null | undefined,
  date: string,
  startMonth: number,
): TargetPeriodKind {
  if (!setting) return 'month';
  if (setting.periodFrom && date < periodDates(setting.periodFrom, startMonth).from) {
    return setting.earlierPeriodType ?? 'month';
  }
  return setting.periodType;
}

/** The period in force on a date: its kind by `periodKindOn()`, then the key the date falls in. */
export function currentPeriod(
  setting: PeriodSetting | null | undefined,
  date: string,
  startMonth: number,
): string {
  return periodOf(periodKindOn(setting, date, startMonth), date, startMonth);
}

/**
 * Why a period can't hold targets or scores under a setting, or null: its kind must be the one in
 * force on its first day, so months stay months until a switch, and the new kind starts on time.
 */
export function periodKeyIssue(
  key: string,
  setting: PeriodSetting | null | undefined,
  startMonth: number,
): string | null {
  const { from } = periodDates(key, startMonth);
  const expected = periodKindOn(setting, from, startMonth);
  if (periodKind(key) !== expected) {
    const example = periodOf(expected, from, startMonth);
    return `This period is counted by the ${expected}; use a key such as ${example}`;
  }
  return null;
}

/**
 * Why a switch to a new kind of period can't start at `periodFrom`, or null: it must be a key of
 * the new kind that hasn't begun by `today`, and begin where the kind before it ends, so no day is
 * counted twice or left out.
 */
export function periodSwitchIssue(
  current: PeriodSetting | null | undefined,
  next: { periodType: TargetPeriodKind; periodFrom?: string | undefined },
  today: string,
  startMonth: number,
): string | null {
  const before = periodKindOn(current, today, startMonth);
  if (next.periodType === before && !next.periodFrom) return null;
  if (next.periodType === before && current?.periodFrom === next.periodFrom) return null;
  if (!next.periodFrom) return 'Choose the first period the new kind counts from';
  if (!isPeriodKey(next.periodFrom) || periodKind(next.periodFrom) !== next.periodType) {
    return `Start from a ${next.periodType}, such as ${periodOf(next.periodType, today, startMonth)}`;
  }
  const { from } = periodDates(next.periodFrom, startMonth);
  if (from <= today) return 'That period has begun; start from one still to come';
  const previous = periodOf(before, dayBefore(from), startMonth);
  if (periodDates(previous, startMonth).to !== dayBefore(from)) {
    return `Start where a ${before} ends, so no day is counted twice`;
  }
  return null;
}
