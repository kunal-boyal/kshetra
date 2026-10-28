import { spacing } from '@thelamp/design-tokens';
import { formatDateTime, formatMoney } from '@thelamp/i18n';
import type { OrderStatus } from '@thelamp/shared';
import {
  Button,
  EmptyState,
  IconChip,
  ListGroup,
  ListRow,
  Screen,
  StatusBadge,
  type BadgeVariant,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { CloudUpload, Plus, ShoppingCart } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useOutboxItems } from '../sync';

/** An order's status as the portal shows it (`ORDER_BADGE` on the web). */
export const ORDER_BADGE: Record<OrderStatus, BadgeVariant> = {
  submitted: 'waiting',
  accepted: 'success',
  partially_accepted: 'pending',
  rejected: 'danger',
  fulfilled: 'success',
  partially_fulfilled: 'info',
  cancelled: 'neutral',
};

/**
 * Orders, the prototype's third tab (decision D104): the person's orders the phone keeps, newest
 * first, with those still waiting to upload above them, each with its account, value and status.
 * An order is taken at an account, so "New order" opens the accounts.
 */
export function OrdersScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const orders = useLocalRows('orders');
  const accounts = useLocalRows('accounts') ?? [];
  const waiting = useOutboxItems().filter((item) => item.kind === 'order.place');
  const settings = config.data?.bundle.settings;
  const timeZone = settings?.timezone ?? 'Asia/Kolkata';
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: settings?.currency ?? 'INR' });
  const name = (accountId: string | undefined) =>
    accounts.find((account) => account.id === accountId)?.name ?? '—';
  const placed = [...(orders ?? [])].sort((a, b) => b.placedAt.localeCompare(a.placedAt));

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.head}>
        <Text variant="headingXl" role="heading" style={styles.grow}>
          {t('orders.title')}
        </Text>
        <Button
          variant="tonal"
          size="sm"
          icon={Plus}
          label={t('orders.take')}
          onPress={() => router.push('/accounts')}
        />
      </View>
      {orders === undefined ? <Text tone="muted">{t('common.loading')}</Text> : null}
      {orders !== undefined && placed.length === 0 && waiting.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={t('orders.empty_title')}>
          {t('orders.mine_empty')}
        </EmptyState>
      ) : null}
      {waiting.length > 0 ? (
        <ListGroup title={t('orders.waiting_to_send')}>
          {waiting.map((item) => (
            <ListRow
              key={item.id}
              lead={<IconChip icon={CloudUpload} hue="butter" />}
              label={name((item.payload as { accountId?: string }).accountId)}
              detail={formatDateTime(new Date(item.createdAt), { locale, timeZone })}
              trailing={<StatusBadge variant="waiting" label={t('orders.waiting_to_send')} />}
            />
          ))}
        </ListGroup>
      ) : null}
      {placed.length > 0 ? (
        <ListGroup title={t('orders.mine')}>
          {placed.map((order) => (
            <ListRow
              key={order.id}
              lead={<IconChip icon={ShoppingCart} hue="butter" />}
              label={name(order.accountId)}
              detail={`${money(order.total)} · ${t('orders.line_count', { count: order.lineCount })}`}
              meta={formatDateTime(new Date(order.placedAt), { locale, timeZone })}
              trailing={
                <StatusBadge
                  variant={ORDER_BADGE[order.status]}
                  label={t(`orders.status_${order.status}`)}
                />
              }
              onPress={() =>
                router.push({ pathname: '/accounts/[id]', params: { id: order.accountId } })
              }
            />
          ))}
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
});
