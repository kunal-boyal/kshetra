import type { SyncRunner } from '@kshetra/api-client/sync';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
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

const iso = (millis: number | null) => (millis === null ? null : new Date(millis).toISOString());

/**
 * Tells the tenant how this phone is (spec 12.1, M3): its versions, battery optimisation, upload
 * queue and last sync. Permissions join as the camera, location and notifications arrive.
 */
export async function sendHeartbeat(client: MobileClient, runner: SyncRunner): Promise<void> {
  const { counts, lastPulledAt } = runner.status;
  const optimised = await batteryOptimised();
  await client.heartbeat({
    appVersion,
    osVersion: (Device.osVersion ?? Platform.OS).slice(0, 32),
    ...(Device.modelName ? { model: Device.modelName.slice(0, 100) } : {}),
    permissions: {},
    ...(optimised === undefined ? {} : { batteryOptimised: optimised }),
    queue: { queued: counts.queued, parked: counts.parked, oldestQueuedAt: iso(counts.oldestAt) },
    lastSyncAt: iso(lastPulledAt),
  });
}
