import { spacing } from '@thelamp/design-tokens';
import { formatMoney, formatNumber } from '@thelamp/i18n';
import { MediaUrlResult, odometerDistance } from '@thelamp/shared';
import { Card, PhotoTile, StatusBadge, Text } from '@thelamp/ui-mobile';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { useClaimDetail } from '../expenses';
import { errorMessage, useLanguage } from '../i18n';
import { usePhotoLink } from '../review';

/**
 * An expense claim on the approval screen (decision D142): what was claimed and what the policy
 * made of it, the readings beside the tracked distance, what to look at, and its receipts and
 * odometer photos, each opening full size. Read online, as deciding is.
 */
export function ClaimPanel({ id }: { id: string }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const claim = useClaimDetail(id);
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const km = (value: string) => formatNumber(Number(value), { locale });

  if (claim.isError) {
    return (
      <Text tone="danger" role="alert">
        {errorMessage(claim.error, t)}
      </Text>
    );
  }
  if (!claim.data) return <Text tone="muted">{t('common.loading')}</Text>;
  const data = claim.data;
  const lines = [
    data.capped ? t('claims.capped_from', { amount: money(data.calculated) }) : null,
    data.quantity !== null && data.rate !== null
      ? t('expenses.detail_quantity_rate', { quantity: km(data.quantity), rate: money(data.rate) })
      : null,
    data.odometerOpen !== null && data.odometerClose !== null
      ? t('expenses.odometer_km', {
          km: km(odometerDistance(data.odometerOpen, data.odometerClose)),
        })
      : null,
    data.trackedKm !== null ? t('expenses.tracked_km', { km: km(data.trackedKm) }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <Card style={styles.stack}>
      <Text variant="headingMd">{money(data.amount)}</Text>
      <Text>{data.description}</Text>
      {lines.map((line) => (
        <Text key={line} tone="muted">
          {line}
        </Text>
      ))}
      {data.flags.length > 0 ? (
        <View style={styles.row}>
          {data.flags.map((flag) => (
            <StatusBadge
              key={flag}
              variant={flag === 'duplicate_receipt' ? 'danger' : 'pending'}
              label={t(
                `expenses.flag_${flag as 'duplicate_receipt' | 'receipt_missing' | 'capped' | 'odometer_changed' | 'distance_gap'}`,
              )}
            />
          ))}
        </View>
      ) : null}
      <Text variant="labelMd" weight={600}>
        {t('expenses.receipts')}
      </Text>
      {data.receipts.length === 0 ? (
        <Text tone="muted">{t('expenses.no_receipts')}</Text>
      ) : (
        <View style={styles.row}>
          {data.receipts.map((photo, index) => (
            <ClaimPhoto key={photo} id={photo} label={t('expenses.receipt_n', { n: index + 1 })} />
          ))}
        </View>
      )}
      {data.odometerPhotos.length > 0 ? (
        <>
          <Text variant="labelMd" weight={600}>
            {t('expenses.odometer_photos')}
          </Text>
          <View style={styles.row}>
            {data.odometerPhotos.map((photo, index) => (
              <ClaimPhoto
                key={photo}
                id={photo}
                label={t('expenses.odometer_n', { n: index + 1 })}
              />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}

/** A claim's photo as a tile; tapping it opens the full-size photo in the phone's browser. */
function ClaimPhoto({ id, label }: { id: string; label: string }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const link = usePhotoLink(id);
  async function open() {
    const full = await client.request(
      'GET',
      `/v1/media/${id}/url?variant=original`,
      MediaUrlResult,
    );
    if (full) await Linking.openURL(full.url);
  }
  return (
    <PhotoTile
      label={t('expenses.open_full', { label })}
      size="lg"
      {...(link.data
        ? { uri: link.data.url, onPress: () => void open().catch(() => undefined) }
        : {})}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
