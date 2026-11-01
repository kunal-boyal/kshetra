import { ApiError } from '@thelamp/api-client';
import {
  type PayAdjustmentBody,
  PayRunResult,
  type SalaryStructureBody,
  SalaryStructureResult,
  StatutoryPayslip,
  type StatutoryProfileBody,
  StatutoryProfileResult,
} from '@thelamp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useApp } from '../context';
import { read, write } from '../people/data';

/** A read that answers null where there is nothing yet, such as a month without a pay run. */
async function readOrNull<T extends z.ZodType>(
  client: Parameters<typeof read>[0],
  path: string,
  schema: T,
): Promise<z.output<T> | null> {
  try {
    return await read(client, path, schema);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/** A month's pay run (D128), null before it is started. */
export function usePayRun(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['pay-run', period],
    queryFn: () => readOrNull(client, `/v1/pay-runs/${period}`, PayRunResult),
  });
}

export function useStatutoryPayslip(userId: string, period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['statutory-payslip', userId, period],
    queryFn: () => read(client, `/v1/statutory-payslips/${userId}/${period}`, StatutoryPayslip),
  });
}

export function useSalary(userId: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['salary', userId],
    queryFn: () => read(client, `/v1/salary-structures/${userId}`, SalaryStructureResult),
  });
}

export function useStatutoryProfile(userId: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['statutory-profile', userId],
    queryFn: () => read(client, `/v1/statutory-profiles/${userId}`, StatutoryProfileResult),
  });
}

/** Changes to pay runs, structures and profiles; what they show reads again after. */
export function usePayrollWrites() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = (...keys: string[]) =>
    Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  return {
    async start(period: string) {
      const run = await write(client, 'POST', '/v1/pay-runs', PayRunResult, { period });
      await refresh('pay-run', 'statutory-payslip');
      return run;
    },
    async recompute(period: string) {
      const run = await write(client, 'POST', `/v1/pay-runs/${period}/recompute`, PayRunResult);
      await refresh('pay-run', 'statutory-payslip');
      return run;
    },
    async approve(period: string, version: number) {
      const run = await write(client, 'POST', `/v1/pay-runs/${period}/approve`, PayRunResult, {
        version,
      });
      await refresh('pay-run', 'statutory-payslip');
      return run;
    },
    async adjust(body: PayAdjustmentBody) {
      await write(client, 'POST', '/v1/pay-adjustments', z.unknown(), body);
    },
    async setStructure(userId: string, body: Partial<SalaryStructureBody>) {
      const result = await write(
        client,
        'PUT',
        `/v1/salary-structures/${userId}`,
        SalaryStructureResult,
        body,
      );
      await refresh('salary');
      return result;
    },
    async setProfile(userId: string, body: Partial<StatutoryProfileBody>) {
      const result = await write(
        client,
        'PUT',
        `/v1/statutory-profiles/${userId}`,
        StatutoryProfileResult,
        body,
      );
      await refresh('statutory-profile');
      return result;
    },
  };
}
