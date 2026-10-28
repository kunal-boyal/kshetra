import { formatDay, formatTime } from '@thelamp/i18n';
import { type Locale, todayIn } from '@thelamp/shared';
import type { Language } from './i18n';

type Translate = Language['t'];

const DAY_MS = 86_400_000;

/** The moment now; a function, so screens read the clock outside render's purity rule. */
export const nowMs = () => Date.now();

/** The tenant's calendar date of a moment. */
export const dayOf = (instant: string, timeZone: string) => todayIn(timeZone, new Date(instant));

/**
 * How long ago something happened, as a list on the phone says it (decision D104): minutes, then
 * hours within the same day, then Yesterday, then the day itself.
 */
export function ago(
  instant: string,
  {
    t,
    locale,
    timeZone,
    now = nowMs(),
  }: { t: Translate; locale: Locale; timeZone: string; now?: number },
): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(instant)) / 60_000));
  const today = todayIn(timeZone, new Date(now));
  const day = dayOf(instant, timeZone);
  if (day === today) {
    if (minutes < 1) return t('time.just_now');
    if (minutes < 60) return t('time.minutes_ago', { count: minutes });
    return t('time.hours_ago', { count: Math.floor(minutes / 60) });
  }
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  if (day === yesterday) return t('time.yesterday');
  return formatDay(day, { locale });
}

/** When, for a row of today's or an earlier day's: the time today, else the day and time. */
export function when(
  instant: string,
  {
    t,
    locale,
    timeZone,
    now = nowMs(),
  }: { t: Translate; locale: Locale; timeZone: string; now?: number },
): string {
  const time = formatTime(instant, { locale, timeZone });
  const today = todayIn(timeZone, new Date(now));
  const day = dayOf(instant, timeZone);
  if (day === today) return time;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  return `${day === yesterday ? t('time.yesterday') : formatDay(day, { locale })}, ${time}`;
}
