import type { ConfigContext, ExpoConfig } from 'expo/config';

// Every name and identifier derives from the product slug (spec 0). Decision D1 settles the real
// name and domain, and with them the store identifiers, before the first store build.
const slug = process.env.PRODUCT_SLUG ?? 'kshetra';
const name = process.env.PRODUCT_NAME ?? 'Kshetra';

// EAS build profiles set the variant (spec 14.3). Development builds carry the dev client and a
// `.dev` identifier, so they install beside a preview or store build.
const variant = process.env.APP_VARIANT ?? 'development';
const development = variant === 'development';
const id = `com.${slug}.app${development ? '.dev' : ''}`;

if (!development && !process.env.EXPO_PUBLIC_DIRECTORY_URL) {
  throw new Error(
    `A ${variant} build needs EXPO_PUBLIC_DIRECTORY_URL in its EAS environment (spec Appendix F).`,
  );
}

// The `bg` token in Light and Dark, and Jamun, which the mark always is (assets/Logos/README.md).
// Plain values: this file runs in Node before the bundler, so it can't import the tokens.
const GROUND = '#f7f6f3';
const DARK_GROUND = '#121110';
const JAMUN = '#5b2b82';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: development ? `${name} dev` : name,
  slug,
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
  },
  android: {
    package: id,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: JAMUN,
    },
  },
  web: { output: 'single' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
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
