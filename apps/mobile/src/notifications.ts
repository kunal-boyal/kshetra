import {
  MarkNotificationsReadResult,
  NotificationListResult,
  type NotificationCategoryKey,
  NotificationPrefsResult,
  newId,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

/**
 * The inbox on the phone (M16, decision D59): read online, a page at a time, with the unread count
 * for Home's bell. Marking read and muting go straight to the server.
 */

const INBOX = ['notifications'] as const;

export function useInbox() {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: INBOX,
    queryFn: async ({ pageParam }) =>
      (await client.request(
        'GET',
        `/v1/notifications?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        NotificationListResult,
      ))!,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** How many are unread, read again every minute while the app is open. */
export function useUnread() {
  const { client } = useApp();
  return useQuery({
    queryKey: [...INBOX, 'unread'],
    queryFn: async () =>
      (await client.request(
        'GET',
        '/v1/notifications?limit=1&unread=true',
        NotificationListResult,
      ))!.unread,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Marks some read, or all; the inbox and the bell read again after. */
export function useMarkRead() {
  const { client, queryClient } = useApp();
  return async (body: { ids: string[] } | { all: true }) => {
    await client.request('POST', '/v1/notifications/read', MarkNotificationsReadResult, {
      body,
      idempotencyKey: newId(),
    });
    await queryClient.invalidateQueries({ queryKey: INBOX });
  };
}

export function useNotificationPrefs() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['notification-prefs'],
    queryFn: async () =>
      (await client.request('GET', '/v1/notification-prefs', NotificationPrefsResult))!,
  });
}

export function useSavePrefs() {
  const { client, queryClient } = useApp();
  return async (muted: NotificationCategoryKey[]) => {
    const result = await client.request('PUT', '/v1/notification-prefs', NotificationPrefsResult, {
      body: { muted },
      idempotencyKey: newId(),
    });
    queryClient.setQueryData(['notification-prefs'], result);
  };
}
