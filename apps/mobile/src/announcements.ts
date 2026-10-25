import { TenantAnnouncementList } from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApp } from './app-state';
import { storage } from './storage';

/** How often Home looks for new announcements while it is shown. */
const EVERY_MS = 10 * 60_000;

const KEY = 'announcements.dismissed';

function dismissed(): string[] {
  try {
    const saved = JSON.parse(storage.read(KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * What the vendor is announcing to the phone's organisation (module M22, decision D93), read
 * online, less those dismissed on this phone. Offline, the last answer stays.
 */
export function useAnnouncements() {
  const { client } = useApp();
  const [gone, setGone] = useState(dismissed);
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: async () =>
      (await client.request('GET', '/v1/announcements?surface=mobile', TenantAnnouncementList))!,
    refetchInterval: EVERY_MS,
  });
  const dismiss = useCallback((id: string) => {
    const next = [...dismissed(), id].slice(-50);
    try {
      storage.write(KEY, JSON.stringify(next));
    } catch {
      // Dismissed until the app closes.
    }
    setGone(next);
  }, []);
  return {
    items: (announcements.data?.items ?? []).filter((item) => !gone.includes(item.id)),
    dismiss,
  };
}
