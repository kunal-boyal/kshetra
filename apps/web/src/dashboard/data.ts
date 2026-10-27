import { DashboardResult, DashboardWaiting } from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** The home dashboard for a month, as the viewer's role sees it (M18). */
export function useDashboard(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => read(client, `/v1/dashboard?period=${period}`, DashboardResult),
  });
}

/** What waits for the viewer, for the rail's counts; read again each minute. */
export function useWaiting() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['dashboard', 'waiting'],
    queryFn: () => read(client, '/v1/dashboard/waiting', DashboardWaiting),
    refetchInterval: 60_000,
  });
}
