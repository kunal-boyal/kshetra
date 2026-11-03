import { formatNumber } from '@thelamp/i18n';
import {
  type DataRequestKindKey,
  DataRequestList,
  DataRequestResult,
  type Locale,
  newId,
} from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking } from 'react-native';
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

/**
 * Whether a request carries the person's copy to download (decision D141): an access request the
 * organisation closed as completed, whose archive is still kept.
 */
export function copyKept(item: DataRequestResult, now = new Date()): boolean {
  return (
    item.kind === 'access' &&
    item.status === 'completed' &&
    item.archive?.status === 'ready' &&
    item.archive.expiresAt !== null &&
    new Date(item.archive.expiresAt) > now
  );
}

/** A copy's size in words a person reads: kilobytes, megabytes or gigabytes. */
export function copySize(bytes: number, locale: Locale): string {
  const [unit, scale] =
    bytes >= 1024 ** 3 ? ['GB', 1024 ** 3] : bytes >= 1024 ** 2 ? ['MB', 1024 ** 2] : ['KB', 1024];
  const value = Math.max(bytes / scale, 0.1);
  return `${formatNumber(value, { locale }, { maximumFractionDigits: 1 })} ${unit}`;
}

/**
 * Opens the person's copy in the system browser (decision D141): the server gives a day's link
 * only to the person, only once the request is completed, and audits each read. Answers false
 * when the copy is no longer kept.
 */
export function useOpenMyCopy() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (id: string): Promise<boolean> => {
    const result = await client.request('GET', `/v1/me/data-requests/${id}`, DataRequestResult);
    if (!result?.download) {
      await queryClient.invalidateQueries({ queryKey: KEY });
      return false;
    }
    await Linking.openURL(result.download.url);
    return true;
  };
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
