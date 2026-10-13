import type { SyncStatus } from '@kshetra/api-client/sync';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { MobileClient } from './client';
import { appVersion } from './device';

/** Whether battery optimisation may stop the app in the background. Only Android says. */
async function batteryOptimised(): Promise<boolean | undefined> {
  if (Platform.OS !== 'android') return undefined;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return undefined;
  }
}

/** Whether the app may use location with the screen off, for tracking during a shift. */
async function backgroundLocation(): Promise<'granted' | 'denied' | 'undetermined' | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    return (await Location.getBackgroundPermissionsAsync()).status as
      'granted' | 'denied' | 'undetermined';
  } catch {
    return undefined;
  }
}

const iso = (millis: number | null) => (millis === null ? null : new Date(millis).toISOString());

/**
 * Tells the tenant how this phone is (spec 12.1, M3): its versions, background location, battery
 * optimisation, upload queue and last sync. The app sends it at start and every 15 minutes, and
 * the shift's background task every 15 minutes on duty.
 */
export async function sendHeartbeat(
  client: Pick<MobileClient, 'heartbeat'>,
  runner: { status: Pick<SyncStatus, 'counts' | 'lastPulledAt'> },
): Promise<void> {
  const { counts, lastPulledAt } = runner.status;
  const optimised = await batteryOptimised();
  const background = await backgroundLocation();
  await client.heartbeat({
    appVersion,
    osVersion: (Device.osVersion ?? Platform.OS).slice(0, 32),
    ...(Device.modelName ? { model: Device.modelName.slice(0, 100) } : {}),
    permissions: background ? { backgroundLocation: background } : {},
    ...(optimised === undefined ? {} : { batteryOptimised: optimised }),
    queue: { queued: counts.queued, parked: counts.parked, oldestQueuedAt: iso(counts.oldestAt) },
    lastSyncAt: iso(lastPulledAt),
  });
}
