import type { ConfigBundle } from '@kshetra/forms';
import type { MeResult } from '@kshetra/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { WebClient } from './client';

interface CachedBundle {
  etag: string | undefined;
  bundle: ConfigBundle;
}

/**
 * The config bundle (spec 11.2). Fetching it again sends the ETag of the copy in hand, so an
 * unchanged bundle costs one lookup and no body.
 */
export function useConfig(client: WebClient, queryClient: QueryClient) {
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

export function useMe(client: WebClient) {
  return useQuery<MeResult>({ queryKey: ['me'], queryFn: () => client.me() });
}
