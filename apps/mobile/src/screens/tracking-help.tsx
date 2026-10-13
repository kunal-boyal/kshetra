import { spacing } from '@kshetra/design-tokens';
import type { MessageKey } from '@kshetra/i18n';
import { Button, Card, ListGroup, ListRow, Screen, StatusBadge, Text } from '@kshetra/ui-mobile';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';

/** Phone makers whose battery managers stop background apps, and the steps each needs. */
const BRANDS = ['xiaomi', 'vivo', 'oppo', 'realme', 'oneplus', 'samsung'] as const;
type Brand = (typeof BRANDS)[number];

/** The phone's maker as the help knows it; Redmi and POCO are Xiaomi. */
export function brandOf(manufacturer: string | null): Brand | 'other' {
  const name = (manufacturer ?? '').toLowerCase();
  if (/xiaomi|redmi|poco/.test(name)) return 'xiaomi';
  return BRANDS.find((brand) => name.includes(brand)) ?? 'other';
}

interface Checks {
  background: boolean;
  optimised: boolean | null;
}

/**
 * Keeping the route recorded (spec 12.1): whether the app may use location all the time and
 * whether battery saving may stop it, and the steps for this phone's maker. Settings open from
 * here; the app never changes them itself.
 */
export function TrackingHelpScreen() {
  const { t } = useLanguage();
  const [checks, setChecks] = useState<Checks>();
  const brand = brandOf(Device.manufacturer);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const background =
          Platform.OS === 'web' ? false : (await Location.getBackgroundPermissionsAsync()).granted;
        let optimised: boolean | null = null;
        if (Platform.OS === 'android') {
          optimised = await Battery.isBatteryOptimizationEnabledAsync().catch(() => null);
        }
        if (live) setChecks({ background, optimised });
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  const steps = (key: Brand | 'other') =>
    [1, 2, 3].map((n) => t(`tracking_help.${key}_${n}` as MessageKey));

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('tracking_help.title')}
      </Text>
      <Text tone="muted">{t('shift.tracking_note')}</Text>
      {checks ? (
        <ListGroup title={t('tracking_help.checks')}>
          <View style={styles.check}>
            <Text style={styles.grow}>{t('tracking_help.location_always')}</Text>
            <StatusBadge
              variant={checks.background ? 'success' : 'danger'}
              label={t(checks.background ? 'tracking_help.allowed' : 'tracking_help.not_allowed')}
            />
          </View>
          {checks.optimised === null ? null : (
            <View style={styles.check}>
              <Text style={styles.grow}>{t('tracking_help.battery')}</Text>
              <StatusBadge
                variant={checks.optimised ? 'danger' : 'success'}
                label={t(
                  checks.optimised ? 'tracking_help.restricted' : 'tracking_help.unrestricted',
                )}
              />
            </View>
          )}
        </ListGroup>
      ) : null}
      <Card style={styles.stack}>
        <Text variant="headingMd">
          {t(brand === 'other' ? 'tracking_help.steps_any' : 'tracking_help.steps_for', {
            brand: t(`tracking_help.brand_${brand}` as MessageKey),
          })}
        </Text>
        {steps(brand).map((step, index) => (
          <View key={step} style={styles.row}>
            <Text weight={600}>{index + 1}.</Text>
            <Text style={styles.grow}>{step}</Text>
          </View>
        ))}
      </Card>
      <Button
        variant="primary"
        icon={Settings}
        label={t('tracking_help.open_settings')}
        onPress={() => void Linking.openSettings()}
      />
      <ListGroup title={t('tracking_help.other_phones')}>
        {BRANDS.filter((other) => other !== brand).map((other) => (
          <ListRow
            key={other}
            label={t(`tracking_help.brand_${other}` as MessageKey)}
            detail={steps(other).join(' ')}
          />
        ))}
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  row: { flexDirection: 'row', gap: spacing.space2 },
  grow: { flex: 1 },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space3,
  },
});
