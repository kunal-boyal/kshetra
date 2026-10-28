import type { Locale } from '@thelamp/shared';

/**
 * Numbers, money and dates for display (spec 8.5): the user's language with the tenant's region,
 * so `en-IN` groups digits in lakhs (₹1,23,456.00). Times show in the tenant's timezone.
 */

export interface FormatContext {
  locale: Locale;
  /** The tenant's default country. */
  region?: string;
}

/** The BCP 47 tag for a language in a region, such as `hi-IN`. */
export function localeTag(locale: Locale, region = 'IN'): string {
  return `${locale}-${region}`;
}

export function formatNumber(
  value: number | `${number}`,
  { locale, region }: FormatContext,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTag(locale, region), options).format(value);
}

/** An amount kept as a decimal string, formatted exactly, never through binary floating point. */
export function formatMoney(
  amount: `${number}`,
  { locale, region, currency = 'INR' }: FormatContext & { currency?: string },
): string {
  return new Intl.NumberFormat(localeTag(locale, region), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** A calendar date (`YYYY-MM-DD`), which already belongs to the tenant's timezone. */
export function formatDate(date: string, { locale, region }: FormatContext): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** A calendar date with its weekday, short, such as Home's "Fri, 23 Oct". */
export function formatDay(date: string, { locale, region }: FormatContext): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** A month (`YYYY-MM`), such as a period of attendance. */
export function formatMonth(period: string, { locale, region }: FormatContext): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`));
}

/** A weekday's short name, 1 being Monday (ISO 8601), such as a calendar's column. */
export function formatWeekday(day: number, { locale, region }: FormatContext): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, day)));
}

/** A moment's time of day alone, in the tenant's timezone, such as "2:21 pm" on a bar. */
export function formatTime(
  instant: Date | string,
  { locale, region, timeZone }: FormatContext & { timeZone: string },
): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    timeStyle: 'short',
    timeZone,
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

/** A moment in time, shown in the tenant's timezone. */
export function formatDateTime(
  instant: Date | string,
  { locale, region, timeZone }: FormatContext & { timeZone: string },
): string {
  return new Intl.DateTimeFormat(localeTag(locale, region), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}
