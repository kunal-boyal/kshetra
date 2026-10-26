// What Hermes lacks comes first, then the background location task (spec 12.1).
import '../polyfills';
import '../background';
import { useTheme } from '@thelamp/ui-mobile';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppProvider, useApp } from '../app-state';
import { startErrorReports } from '../error-reports';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { UpdateRequiredScreen } from '../screens/update-required';
import { SyncProvider } from '../sync';

// Error reports, once the build names where they go (decision D98).
startErrorReports();

// The splash screen stays up until the fonts are in and the saved session has been looked for.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <LanguageProvider>
      <AppProvider>
        <SyncProvider>
          <Look>
            <Routes />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>
  );
}

/**
 * Signed out, only sign-in exists; signed in, only the app. Signing in or out flips the guards and
 * the router moves to whichever screen remains. An app too old for the API shows nothing but its
 * update screen (M1, rule 8).
 */
function Routes() {
  const { session, restored, upgradeRequired } = useApp();
  const theme = useTheme();

  useEffect(() => {
    if (restored) void SplashScreen.hideAsync();
  }, [restored]);

  if (!restored) return null;
  if (upgradeRequired) return <UpdateRequiredScreen />;
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
    >
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
