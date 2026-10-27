import { type FormatContext, formatMoney, formatNumber } from './format';

/** The strings a short figure is written with. */
type Say = (
  key: 'performance.percent' | 'performance.minutes' | 'performance.lakh' | 'performance.crore',
  params: { value: string },
) => string;

/**
 * A figure short enough for a tile (components/KpiTile): lakh and crore past a lakh, in the
 * tenant's currency for money. Full figures belong everywhere else.
 */
export function shortFigure(
  unit: string,
  value: string,
  context: { locale: FormatContext['locale']; currency: string; t: Say },
): string {
  const { locale, currency, t } = context;
  const number = Number(value);
  if (unit === 'percent') {
    return t('performance.percent', {
      value: formatNumber(number, { locale }, { maximumFractionDigits: 1 }),
    });
  }
  if (unit === 'duration') {
    return t('performance.minutes', {
      value: formatNumber(number, { locale }, { maximumFractionDigits: 0 }),
    });
  }
  const size = Math.abs(number);
  const scale = size >= 1e7 ? 1e7 : size >= 1e5 ? 1e5 : 1;
  const shown = formatNumber(
    number / scale,
    { locale },
    { maximumFractionDigits: scale > 1 ? 1 : 2 },
  );
  if (unit === 'currency') {
    if (scale === 1)
      return formatMoney(String(Math.round(number)) as `${number}`, { locale, currency });
    // The currency's symbol, as the locale writes it: what formats 0, less its digits.
    const symbol = formatMoney('0', { locale, currency }).replace(/[\d.,\s]/g, '');
    return t(scale === 1e7 ? 'performance.crore' : 'performance.lakh', {
      value: `${symbol}${shown}`,
    });
  }
  if (scale === 1) return shown;
  return t(scale === 1e7 ? 'performance.crore' : 'performance.lakh', { value: shown });
}
