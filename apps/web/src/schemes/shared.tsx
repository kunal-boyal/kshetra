import { formatMoney, formatNumber } from '@thelamp/i18n';
import type { SchemeResult } from '@thelamp/shared';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

/** What a scheme gives, in a few words: "5% off", "₹20 off each unit", "2% from 100 · 4% from 250". */
export function useGives() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const number = (value: string) => formatNumber(Number(value), { locale });
  return (scheme: Pick<SchemeResult, 'kind' | 'rule'>): string => {
    const { rule } = scheme;
    switch (scheme.kind) {
      case 'percentage':
        return t('schemes.gives_percent', { percent: number(rule.percent ?? '0') });
      case 'flat_per_unit':
        return t('schemes.gives_amount', {
          amount: formatMoney((rule.amount ?? '0') as `${number}`, {
            locale,
            currency: access.currency,
          }),
        });
      case 'slabs':
        return (rule.slabs ?? [])
          .map((slab) =>
            t('schemes.gives_slab', { percent: number(slab.percent), from: number(slab.from) }),
          )
          .join(' · ');
      case 'free_goods':
        return t('schemes.gives_free', {
          get: number(rule.get ?? '0'),
          buy: number(rule.buy ?? '0'),
        });
    }
  };
}
