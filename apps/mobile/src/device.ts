import type { AppPlatform, DeviceInfo } from '@thelamp/shared';
import Constants from 'expo-constants';
import { getRandomBytes } from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { storage } from './storage';

/** The browser stands in for an Android phone in development, so binding can be tried there. */
export const appPlatform: AppPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

/** The store version, which the API compares with each platform's minimum (M1, rule 8). */
export const appVersion = Constants.expoConfig?.version ?? '0.0.0';

const KEY = 'device-key';

/**
 * The secret that names this phone to the tenant (M1, rule 5): 32 random bytes made once and kept
 * in the secure store, never sent anywhere but sign-in. The cell keeps only its hash.
 */
function deviceKey(): string {
  const saved = storage.read(KEY);
  if (saved) return saved;
  const key = Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  storage.write(KEY, key);
  return key;
}

/** What the app tells the tenant about this phone at sign-in. */
export async function deviceInfo(): Promise<DeviceInfo> {
  return {
    key: deviceKey(),
    platform: appPlatform,
    ...(Device.modelName ? { model: Device.modelName.slice(0, 100) } : {}),
    ...(Device.osVersion ? { osVersion: Device.osVersion.slice(0, 40) } : {}),
    appVersion,
  };
}
