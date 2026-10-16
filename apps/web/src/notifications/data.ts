import { NotificationListResult, NotificationPrefsResult } from '@kshetra/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** The person's inbox (M16), a page at a time, newest first. */
export function useInbox() {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/notifications?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        NotificationListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** How many are unread, for the header; read again every minute. */
export function useUnread() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () =>
      (await read(client, '/v1/notifications?limit=1&unread=true', NotificationListResult)).unread,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useNotificationPrefs() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => read(client, '/v1/notification-prefs', NotificationPrefsResult),
  });
}
