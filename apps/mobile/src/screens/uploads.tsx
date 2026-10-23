import { OUTBOX_CODES, type OutboxItem } from '@thelamp/api-client/sync';
import { spacing } from '@thelamp/design-tokens';
import { formatDateTime } from '@thelamp/i18n';
import { isErrorCode } from '@thelamp/shared';
import { Button, Card, EmptyState, Notice, Screen, StatusBadge, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, CloudCheck, RefreshCw, RotateCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { itemLabel } from '../outbox-kinds';
import { useOutboxItems, useSync, useSyncStatus } from '../sync';

type Translate = ReturnType<typeof useLanguage>['t'];

/** Why an item is waiting or was refused, in the reader's language. */
function reason(item: OutboxItem, t: Translate): string | null {
  const code = item.lastErrorCode;
  if (!code) return null;
  if (code === OUTBOX_CODES.dependencyDiscarded) return t('uploads.DEPENDENCY_DISCARDED');
  if (code === OUTBOX_CODES.unknownKind) return t('uploads.UNKNOWN_KIND');
  if (code === 'NETWORK') return t('common.offline');
  if (isErrorCode(code)) return t(`error.${code}`);
  return item.lastError;
}

/**
 * The upload queue (spec 8.1 More, 11.3): every record still on the phone, with its state and
 * last error. Refused records can be tried again or discarded; discarding asks first.
 */
export function UploadsScreen() {
  const { t, locale } = useLanguage();
  const sync = useSync();
  const status = useSyncStatus();
  const items = useOutboxItems();
  const config = useConfig();
  const [confirming, setConfirming] = useState<string>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const when = (millis: number) => formatDateTime(new Date(millis), { locale, timeZone });

  async function act(work: (ready: NonNullable<ReturnType<typeof useSync>>) => Promise<void>) {
    if (!sync) return;
    await work(sync);
    await sync.runner.refresh();
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('uploads.title')}
      </Text>
      <Text tone="muted">{t('uploads.intro')}</Text>

      <View style={styles.row}>
        <Text variant="bodySm" tone="muted" style={styles.grow}>
          {status?.lastPulledAt
            ? t('uploads.last_sync', { time: when(status.lastPulledAt) })
            : t('uploads.never_synced')}
        </Text>
        <Button
          variant="tonal"
          icon={RefreshCw}
          label={t('uploads.sync_now')}
          busy={status?.running ?? false}
          disabled={!sync}
          onPress={() => void sync?.runner.sync()}
        />
      </View>
      {status?.offline ? <Notice>{t('uploads.offline')}</Notice> : null}

      {items.length === 0 ? (
        <EmptyState icon={CloudCheck} hue="mint" title={t('uploads.empty_title')}>
          {t('uploads.empty_body')}
        </EmptyState>
      ) : (
        items.map((item) => {
          const why = reason(item, t);
          const parked = item.state === 'parked';
          return (
            <Card key={item.id} style={styles.item}>
              <View style={styles.row}>
                <Text variant="headingMd" style={styles.grow}>
                  {itemLabel(item, t)}
                </Text>
                <StatusBadge
                  variant={parked ? 'danger' : 'pending'}
                  label={t(parked ? 'uploads.parked' : 'uploads.queued')}
                />
              </View>
              <Text variant="bodySm" tone="muted">
                {t('uploads.saved_at', { time: when(item.createdAt) })}
              </Text>
              {why ? (
                <Text variant="bodySm" tone={parked ? 'danger' : 'muted'}>
                  {why}
                </Text>
              ) : null}
              {!parked && item.nextAttemptAt ? (
                <Text variant="bodySm" tone="muted">
                  {t('uploads.next_try', { time: when(item.nextAttemptAt) })}
                </Text>
              ) : null}
              {parked && confirming === item.id ? (
                <View style={styles.stack}>
                  <Text variant="bodySm" weight={500} role="alert">
                    {t('uploads.discard_confirm')}
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      variant="danger"
                      icon={Trash2}
                      label={t('uploads.discard_yes')}
                      onPress={() => void act((ready) => ready.outbox.discard(item.id))}
                    />
                    <Button
                      variant="secondary"
                      label={t('uploads.discard_no')}
                      onPress={() => setConfirming(undefined)}
                    />
                  </View>
                </View>
              ) : parked ? (
                <View style={styles.actions}>
                  <Button
                    variant="tonal"
                    icon={RotateCw}
                    label={t('common.retry')}
                    onPress={() =>
                      void act(async (ready) => {
                        await ready.outbox.retry(item.id);
                        void ready.runner.sync();
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    label={t('uploads.discard')}
                    onPress={() => setConfirming(item.id)}
                  />
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  grow: { flex: 1 },
  stack: { gap: spacing.space3 },
  item: { gap: spacing.space2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
