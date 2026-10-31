import { PayslipResult } from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

/**
 * The person's own pay estimate on the phone (M14, decision D117): a month's payslip preview,
 * read online from the route the portal uses; nothing is kept on the phone.
 */
export function useMyPayslip(period: string) {
  const { client } = useApp();
  // The phone's owner is `tenant:user`.
  const userId = client.owner?.split(':')[1];
  return useQuery({
    queryKey: ['my-payslip', userId, period],
    queryFn: async () =>
      (await client.request('GET', `/v1/payslips/${userId}/${period}`, PayslipResult))!,
    enabled: userId !== undefined,
  });
}
