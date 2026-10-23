import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  Button,
  EmptyState,
  ListGroup,
  ListRow,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Tag } from 'lucide-react-native';
import { useState } from 'react';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useAccountPrices } from '../prices';

/**
 * `/prices/<accountId>`: what each item costs at an account today (spec 5.11, decision D77),
 * worked out on the phone from the price lists it keeps, so it reads offline: the net rate per
 * base unit, the price and discount it comes from, and the list.
 */
export function PricesScreen({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const accounts = useLocalRows('accounts');
  const account = accounts?.find((entry) => entry.id === accountId);
  const prices = useAccountPrices(account);
  const [q, setQ] = useState('');
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const needle = q.trim().toLowerCase();
  const shown = (prices ?? []).filter(
    ({ item }) =>
      !needle ||
      item.name.toLowerCase().includes(needle) ||
      item.code.toLowerCase().includes(needle),
  );

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
      />
      <Text variant="headingXl" role="heading">
        {t('prices.at', { name: account?.name ?? '' })}
      </Text>
      {accounts !== undefined && !account ? (
        <Text tone="muted">{t('account.gone')}</Text>
      ) : prices === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : prices.length === 0 ? (
        <EmptyState icon={Tag} title={t('prices.none_title')}>
          {t('prices.none_body')}
        </EmptyState>
      ) : (
        <>
          <Text tone="muted">{t('prices.on_phone')}</Text>
          <TextField label={t('prices.find_item')} value={q} onChangeText={setQ} />
          <ListGroup title={t('prices.items_priced', { count: shown.length })}>
            {shown.map(({ item, price, discount, rate, list }) => (
              <ListRow
                key={item.id}
                label={`${item.name} · ${money(rate)}`}
                detail={[
                  item.code,
                  Number(discount) > 0
                    ? t('prices.less', {
                        price: money(price),
                        discount: formatNumber(
                          discount as `${number}`,
                          { locale },
                          { maximumFractionDigits: 4 },
                        ),
                      })
                    : null,
                  list.name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </ListGroup>
        </>
      )}
    </Screen>
  );
}
