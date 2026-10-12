import { useTheme } from '@kshetra/ui-mobile';
import { Stack } from 'expo-router';

/**
 * The signed-in app: the tabs, and the screens that open full screen above them (spec 8.1),
 * such as the upload queue and an account.
 */
export default function AppLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="uploads" />
      <Stack.Screen name="accounts/[id]" />
      <Stack.Screen name="accounts/new" />
    </Stack>
  );
}
