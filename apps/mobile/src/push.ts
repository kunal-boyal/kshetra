import { newId } from '@thelamp/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useApp } from './app-state';
import { useLanguage } from './i18n';

/**
 * Push on the phone (M16, decision D59). Once signed in, the phone asks to show notifications,
 * gets its Expo push address and tells the server, with the language it reads; it tells it again
 * whenever the address or the language changes. Without a connection it tries again the next time
 * the app opens. Tapping a notification opens where it leads, or the inbox.
 */

/** Notifications that arrive while the app is open show as they would outside it. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The paths the app can open from a notification; anything else opens the inbox. */
const APP_PATHS = new Set(['/', '/notifications', '/leaderboard', '/uploads']);

export function openLink(link: unknown): void {
  const path = typeof link === 'string' && APP_PATHS.has(link) ? link : '/notifications';
  router.push(path as '/');
}

/** Registers this phone for push once signed in; does nothing on the web or an emulator. */
export function usePushRegistration(): void {
  const { client, session } = useApp();
  const { t, locale } = useLanguage();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!session || Platform.OS === 'web' || !Device.isDevice) return;
    let live = true;
    void (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: t('push.channel'),
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Notifications.requestPermissionsAsync();
      }
      if (!permission.granted || !live) return;
      const projectId = (
        Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
      )?.eas?.projectId;
      const { data: token } = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const key = `${token}|${locale}`;
      if (!live || sent.current === key) return;
      await client.registerPush({ token, locale }, newId());
      sent.current = key;
    })().catch(() => {
      // Offline, refused or not configured: the next start tries again.
    });
    return () => {
      live = false;
    };
  }, [client, session, locale, t]);
}

/** Opens where a tapped notification leads, including the one that started the app. */
export function useNotificationTaps(): void {
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    openLink(last.notification.request.content.data?.link);
  }, [last]);
}
