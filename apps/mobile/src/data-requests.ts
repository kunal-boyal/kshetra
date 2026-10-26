import {
  type DataRequestKindKey,
  DataRequestList,
  DataRequestResult,
  newId,
} from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './app-state';

const KEY = ['my-data-requests'];

/**
 * The person's own requests about their personal data (module M21, decision D95), read online:
 * they are rare, and their answers come from the organisation.
 */
export function useMyDataRequests() {
  const { client } = useApp();
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await client.request('GET', '/v1/me/data-requests', DataRequestList))!,
  });
}

/** Sends a request straight away, under its own ID, so a retry sends it once. */
export function useRaiseDataRequest() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (kind: DataRequestKindKey, details: string) => {
    const id = newId();
    const result = await client.request('POST', '/v1/me/data-requests', DataRequestResult, {
      body: { id, kind, details: details.trim() },
      idempotencyKey: id,
    });
    await queryClient.invalidateQueries({ queryKey: KEY });
    return result!;
  };
}
