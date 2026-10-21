import {
  AccountPinsResult,
  DensityResult,
  LIVE_REFRESH_MS,
  LiveResult,
  TrailResult,
} from '@kshetra/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** Everyone on duty in scope, read again every 30 seconds (decision D60). */
export function useLive() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['live'],
    queryFn: () => read(client, '/v1/live', LiveResult),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useAccountPins(enabled = true, period?: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-pins', period ?? 'now'],
    queryFn: () =>
      read(client, `/v1/account-pins${period ? `?period=${period}` : ''}`, AccountPinsResult),
    enabled,
  });
}

export function useTrail(userId: string, date: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['trail', userId, date],
    queryFn: () => read(client, `/v1/trails?userId=${userId}&date=${date}`, TrailResult),
  });
}

export function useDensity(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['density', period],
    queryFn: () => read(client, `/v1/density?period=${period}`, DensityResult),
  });
}
