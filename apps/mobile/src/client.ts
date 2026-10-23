import { createClient } from '@thelamp/api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { appPlatform, appVersion, deviceInfo } from './device';
import { sessionStore } from './session-store';

/** Locally the API listens on this port of the machine running the Expo dev server. */
const DEV_API_PORT = 3000;

/**
 * Where the directory is. A build gets it from its EAS environment (spec Appendix F). In
 * development it is the machine serving the JavaScript, so a phone on the same network finds the
 * API with no settings; run the API with HOST=0.0.0.0 for that.
 */
function directoryUrl(): string {
  const configured = process.env.EXPO_PUBLIC_DIRECTORY_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (!__DEV__) throw new Error('This build has no EXPO_PUBLIC_DIRECTORY_URL.');
  const host =
    Platform.OS === 'web'
      ? window.location.hostname
      : (Constants.expoConfig?.hostUri?.split(':')[0] ?? '127.0.0.1');
  return `http://${host}:${DEV_API_PORT}`;
}

export interface ClientEvents {
  /** Signed out, revoked, or no longer refreshable. */
  onSignedOut: () => void;
  /** The API no longer supports this version (M1, rule 8). */
  onUpgradeRequired: () => void;
}

/**
 * The API client for the phone. Its refresh token lives in the secure store, it names this phone
 * at sign-in so the tenant can bind it, and it names the app's version on every request.
 */
export function mobileClient(events: ClientEvents) {
  const directory = directoryUrl();
  return createClient({
    directoryUrl: directory,
    platform: 'app',
    store: sessionStore,
    device: deviceInfo,
    app: { platform: appPlatform, version: appVersion },
    // The cell's address comes from sign-in. In development it is this machine, which the
    // address the API hands out (often 127.0.0.1) may not reach from a phone.
    ...(__DEV__ && !process.env.EXPO_PUBLIC_DIRECTORY_URL ? { cellUrl: () => directory } : {}),
    ...events,
  });
}

export type MobileClient = ReturnType<typeof mobileClient>;
