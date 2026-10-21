import { spacing } from '@kshetra/design-tokens';
import type { AccountType } from '@kshetra/forms';
import { formatNumber } from '@kshetra/i18n';
import { geofenceRadius, type SyncAccount } from '@kshetra/shared';
import { Button, StatusBadge, Text } from '@kshetra/ui-mobile';
import { LocateFixed } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useFix } from '../location';
import { PhoneMap, Ring, Spot } from '../maps';
import { geofenceAt } from '../visits';

/** The circle around the person's own dot stops growing here, so a vague fix can't hide the map. */
const ACCURACY_RING_MAX_M = 200;

/**
 * The visit's map card (spec 8.1): the account's place with its geofence, where the phone is, and
 * a distance pill, green inside and amber outside, judged as a check-in would be (BR-33).
 */
export function VisitMap({
  account,
  type,
}: {
  account: SyncAccount;
  type: AccountType | undefined;
}) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const fix = useFix();
  const settings = config.data?.bundle.settings;
  if (!settings || !account.location) return null;
  const place = account.location;
  const me = fix.status === 'ready' ? fix.fix : null;
  const fence = me ? geofenceAt(account, type, settings, me) : null;
  const radiusM =
    fence?.radiusM ??
    geofenceRadius(
      account.geofenceRadiusM,
      type?.location.geofenceRadiusM,
      settings.geofenceRadiusMeters,
    );
  const metres = (value: number) => formatNumber(value, { locale });

  return (
    <View style={styles.stack}>
      <PhoneMap
        label={t('visit.map_label', { name: account.name })}
        fit={me ? [place, me] : [place]}
        frame={me ? me.capturedAt : fix.status}
      >
        <Ring at={place} metres={radiusM} />
        <Spot at={place} title={account.name} />
        {me ? (
          <>
            <Ring at={me} metres={Math.min(me.accuracy, ACCURACY_RING_MAX_M)} tone="info" />
            <Spot at={me} title={t('visit.you')} tone="info" />
          </>
        ) : null}
      </PhoneMap>
      <View style={styles.row}>
        <View style={styles.grow}>
          {fix.status === 'locating' ? (
            <Text tone="muted">{t('visit.locating')}</Text>
          ) : fix.status === 'denied' ? (
            <Text tone="muted">{t('shift.fix_denied')}</Text>
          ) : fix.status === 'unavailable' ? (
            <Text tone="muted">{t('shift.fix_unavailable')}</Text>
          ) : fence?.result === 'inside' ? (
            <StatusBadge
              variant="success"
              label={t('visit.pill_inside', { distance: metres(fence.distanceM ?? 0) })}
            />
          ) : fence?.result === 'outside' ? (
            <StatusBadge
              variant="pending"
              label={t('visit.pill_outside', { distance: metres(fence.distanceM ?? 0) })}
            />
          ) : (
            <StatusBadge variant="neutral" label={t('visit.pill_unverified')} />
          )}
        </View>
        <Button
          variant="ghost"
          icon={LocateFixed}
          label={t('visit.locate_again')}
          busy={fix.status === 'locating'}
          onPress={fix.refresh}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1, alignItems: 'flex-start' },
});
