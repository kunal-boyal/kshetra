import type { ConfigBundle, MeResult } from '@kshetra/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

interface CachedBundle {
  etag: string | undefined;
  bundle: ConfigBundle;
}

/**
 * The config bundle (spec 11.2). Fetching it again sends the ETag of the copy in hand, so an
 * unchanged bundle costs one lookup and no body. Phase 1 keeps it on the phone for offline starts.
 */
export function useConfig() {
  const { client, queryClient } = useApp();
  return useQuery({
    queryKey: ['config'],
    queryFn: async (): Promise<CachedBundle> => {
      const held = queryClient.getQueryData<CachedBundle>(['config']);
      const result = await client.config(held?.etag);
      if (result.status === 'not_modified' && held) return held;
      if (result.status === 'not_modified') throw new Error('The server had nothing new to send.');
      return { etag: result.etag, bundle: result.bundle };
    },
  });
}

export function useMe() {
  const { client } = useApp();
  return useQuery<MeResult>({ queryKey: ['me'], queryFn: () => client.me() });
}
