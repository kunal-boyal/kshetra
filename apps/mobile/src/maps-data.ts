import { LIVE_REFRESH_MS, LiveResult, TrailResult } from '@kshetra/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

/**
 * Maps for managers on the phone (M17, decision D61): who is on duty and a person's day, read
 * online from the routes the web uses; nothing is kept on the phone.
 */

/** Everyone on duty in the caller's scope, read again every 30 seconds while shown. */
export function useLive(enabled = true) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['live'],
    queryFn: async () => (await client.request('GET', '/v1/live', LiveResult))!,
    enabled,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/** One person's day: their shifts' routes, gaps, pauses and visits. */
export function useTrail(userId: string, date: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['trail', userId, date],
    queryFn: async () =>
      (await client.request(
        'GET',
        `/v1/trails?userId=${encodeURIComponent(userId)}&date=${date}`,
        TrailResult,
      ))!,
  });
}
