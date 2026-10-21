import { DashboardResult } from '@kshetra/shared';
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
