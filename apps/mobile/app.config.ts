import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// The product's names (decision D1), which `pnpm rename` keeps in step with product.json. The app
// ID is fixed once the first store build is uploaded; the Expo project keeps the name it was
// registered under.
const slug = process.env.PRODUCT_SLUG ?? 'kshetra';
const name = process.env.PRODUCT_NAME ?? 'Kshetra';
const APP_ID = 'com.kshetra.app';
const EXPO_PROJECT = 'kshetra';

// EAS build profiles set the variant (spec 14.3). Development builds carry the dev client and a
// `.dev` identifier, so they install beside a preview or store build.
const variant = process.env.APP_VARIANT ?? 'development';
const development = variant === 'development';
// Maestro's builds (decision D68) install beside the others, and alone may reach a local API over
// plain HTTP; every other build talks HTTPS only.
const e2e = variant === 'e2e';
const id = `${APP_ID}${development ? '.dev' : e2e ? '.e2e' : ''}`;

if (!development && !process.env.EXPO_PUBLIC_DIRECTORY_URL) {
  throw new Error(
    `A ${variant} build needs EXPO_PUBLIC_DIRECTORY_URL in its EAS environment (spec Appendix F).`,
  );
}

// Firebase's file for Android push (decision D59): an EAS file variable in cloud builds, or a local
// copy beside this file. It is never committed; without it the app builds, but push can't register.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (existsSync('./google-services.json') ? './google-services.json' : undefined);

// The `bg` token in Light and Dark, and Jamun, which the mark always is (assets/Logos/README.md).
// Plain values: this file runs in Node before the bundler, so it can't import the tokens.
const GROUND = '#f7f6f3';
const DARK_GROUND = '#121110';
const JAMUN = '#5b2b82';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: development ? `${name} dev` : e2e ? `${name} e2e` : name,
  slug: EXPO_PROJECT,
  // The Expo account that owns the project (decision D34).
  owner: 'kunalboyal',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: slug,
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // JavaScript updates reach only builds of the same app version (spec 14.3).
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: id,
    supportsTablet: false,
    // Tracking during a shift (spec 12.1). No significant-change monitoring, so a force-quit app
    // is never relaunched in the background.
    infoPlist: { UIBackgroundModes: ['location', 'remote-notification'] },
  },
  android: {
    package: id,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: JAMUN,
    },
    // Only what the app uses (spec 12.1): location, the camera and the shift notification.
    // RECEIVE_BOOT_COMPLETED is for expo-task-manager, which hands each batch of points to the
    // task through a job Android keeps across reboots, and refuses without it (the app crashed on
    // its first point). It doesn't restart recording after a reboot: that never happens (BR-37).
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'RECEIVE_BOOT_COMPLETED',
      'CAMERA',
    ],
    blockedPermissions: [
      'RECORD_AUDIO',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_AUDIO',
    ],
  },
  web: { output: 'single' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-sqlite',
    // Live photos only, never the microphone (spec 12.2, 13.3).
    [
      'expo-camera',
      {
        cameraPermission: `${name} uses the camera to take photos of your work.`,
        recordAudioAndroid: false,
      },
    ],
    // Where the person stands: sorting and placing places while the app is open (M4), and the
    // route of a shift, with the screen off too, from punch-in to punch-out (M5, spec 12.1). A
    // notification stays while a shift is tracked.
    [
      'expo-location',
      {
        locationWhenInUsePermission: `${name} uses your location to sort nearby places and to record where a place is.`,
        locationAlwaysAndWhenInUsePermission: `${name} records your location while you are on duty, including with the screen off, until you punch out.`,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-task-manager',
    // Notifications (M16, decision D59): the white glyph on Jamun, and one default channel.
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: JAMUN,
        defaultChannel: 'default',
      },
    ],
    // Maps on the phone (M17, decision D61): Google Maps on Android, with the key EAS supplies
    // (`GOOGLE_MAPS_ANDROID_KEY`), limited to these apps' certificates. Without it, maps are blank.
    [
      'react-native-maps',
      process.env.GOOGLE_MAPS_ANDROID_KEY
        ? { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY }
        : {},
    ],
    ...(e2e
      ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }] as [string, object]]
      : []),
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 120,
        backgroundColor: GROUND,
        dark: { image: './assets/splash.png', backgroundColor: DARK_GROUND },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    // Resolves native modules the way Metro resolves JavaScript, so a monorepo never links two
    // copies of one.
    autolinkingModuleResolution: true,
  },
  extra: {
    productName: name,
    // The EAS project @kunalboyal/kshetra (decision D34). Not a secret.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '9a63d9ab-5510-4768-94ee-ddad44168a4d' },
  },
});
