import { NetworkError } from '@thelamp/api-client';
import { readCache, writeCache } from '@thelamp/api-client/sync';
import type { ConfigBundle } from '@thelamp/forms';
import type { MeResult } from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';
import { useSync } from './sync';

interface CachedBundle {
  etag: string | undefined;
  bundle: ConfigBundle;
}

/**
 * Asks the server, and keeps the answer on the phone. Offline, the kept copy serves, so the app
 * starts without signal (spec 11.3).
 */
export function useKept<T>(key: string, ask: (held: T | null) => Promise<T>) {
  const { client, queryClient } = useApp();
  const sync = useSync();
  return useQuery({
    queryKey: [key],
    queryFn: async (): Promise<T> => {
      const owner = client.owner;
      const held =
        queryClient.getQueryData<T>([key]) ??
        (sync && owner ? await readCache<T>(sync.db, owner, key) : null);
      try {
        const answer = await ask(held);
        if (sync && owner && answer !== held) await writeCache(sync.db, owner, key, answer);
        return answer;
      } catch (error) {
        if (error instanceof NetworkError && held) return held;
        throw error;
      }
    },
  });
}

/**
 * The config bundle (spec 11.2). Fetching it again sends the ETag of the copy in hand, so an
 * unchanged bundle costs one lookup and no body.
 */
export function useConfig() {
  const { client } = useApp();
  return useKept<CachedBundle>('config', async (held) => {
    const result = await client.config(held?.etag);
    if (result.status === 'not_modified' && held) return held;
    if (result.status === 'not_modified') throw new Error('The server had nothing new to send.');
    return { etag: result.etag, bundle: result.bundle };
  });
}

export function useMe() {
  const { client } = useApp();
  return useKept<MeResult>('me', () => client.me());
}
