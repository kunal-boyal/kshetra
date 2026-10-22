import { useTheme } from '@kshetra/ui-mobile';
import { Stack } from 'expo-router';
import { useTenantBrand } from '../../look';
import { useNotificationTaps, usePushRegistration } from '../../push';

/**
 * The signed-in app: the tabs, and the screens that open full screen above them (spec 8.1),
 * such as the upload queue and an account. Signed in, the phone registers for push, and a tapped
 * notification opens where it leads (decision D59), and the app takes the tenant's accent (D64).
 */
export default function AppLayout() {
  const theme = useTheme();
  usePushRegistration();
  useNotificationTaps();
  useTenantBrand();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="uploads" />
      <Stack.Screen name="accounts/[id]" />
      <Stack.Screen name="accounts/new" />
      <Stack.Screen name="forms/[id]" />
      <Stack.Screen name="review/[id]" />
      <Stack.Screen name="camera" options={{ animation: 'fade' }} />
      <Stack.Screen name="scan" options={{ animation: 'fade' }} />
      <Stack.Screen name="punch-in" />
      <Stack.Screen name="tracking-help" />
      <Stack.Screen name="leaderboard" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
