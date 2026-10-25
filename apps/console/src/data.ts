import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CellListResult,
  ConsoleTenant,
  ConsoleTenantList,
  type CreatePlanBody,
  CreateTenantBody,
  InviteStaffResult,
  type PlanBody,
  PlanListResult,
  PlanResult,
  StaffListResult,
  StaffResult,
  TemplateListResult,
  TenantEntitlements,
  type TenantPlanBody,
  type TenantStatusSchema,
  TenantUsageResult,
} from '@thelamp/shared';
import type { z } from 'zod';
import { useConsole } from './context';

type TenantStatus = z.infer<typeof TenantStatusSchema>;

/** Tenants, a page at a time, as the API pages them, with a Load more for the next page. */
export function useTenants(filters: { status?: TenantStatus; q?: string }) {
  const { client } = useConsole();
  return useInfiniteQuery({
    queryKey: ['tenants', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '50' });
      if (filters.status) query.set('status', filters.status);
      if (filters.q) query.set('q', filters.q);
      if (pageParam) query.set('cursor', pageParam);
      return client.request('GET', `/platform/v1/tenants?${query}`, ConsoleTenantList);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useTenant(id: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['tenant', id],
    queryFn: () => client.request('GET', `/platform/v1/tenants/${id}`, ConsoleTenant),
  });
}

export function useTemplates() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => client.request('GET', '/platform/v1/templates', TemplateListResult),
    staleTime: Infinity,
  });
}

export function useCells() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['cells'],
    queryFn: () => client.request('GET', '/platform/v1/cells', CellListResult),
  });
}

/** Every plan, switched off ones included, with how many tenants are on each (M23). */
export function usePlans() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => client.request('GET', '/platform/v1/plans', PlanListResult),
  });
}

/** A tenant's plan, the modules beyond it and the limits in force (decision D89). */
export function useEntitlements(tenantId: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['entitlements', tenantId],
    queryFn: () =>
      client.request('GET', `/platform/v1/tenants/${tenantId}/entitlements`, TenantEntitlements),
  });
}

/** A tenant's metered usage for its last six months, newest first. */
export function useUsage(tenantId: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['usage', tenantId],
    queryFn: () =>
      client.request('GET', `/platform/v1/tenants/${tenantId}/usage?months=6`, TenantUsageResult),
  });
}

export function useStaff() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['staff'],
    queryFn: () => client.request('GET', '/platform/v1/staff', StaffListResult),
  });
}

/** Changes go through here, and every list they touch reads again afterwards. */
export function useConsoleMutations() {
  const { client } = useConsole();
  const queries = useQueryClient();
  const refresh = (keys: string[]) =>
    Promise.all(keys.map((key) => queries.invalidateQueries({ queryKey: [key] })));
  return {
    createTenant: useMutation({
      mutationFn: (body: z.input<typeof CreateTenantBody>) =>
        client.request('POST', '/platform/v1/tenants', ConsoleTenant, body),
      onSuccess: () => refresh(['tenants', 'cells', 'plans']),
    }),
    suspend: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        client.request('POST', `/platform/v1/tenants/${id}/suspend`, ConsoleTenant, { reason }),
      onSuccess: () => refresh(['tenants', 'tenant']),
    }),
    reactivate: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/tenants/${id}/reactivate`, ConsoleTenant),
      onSuccess: () => refresh(['tenants', 'tenant']),
    }),
    createPlan: useMutation({
      mutationFn: (body: z.input<typeof CreatePlanBody>) =>
        client.request('POST', '/platform/v1/plans', PlanResult, body),
      onSuccess: () => refresh(['plans']),
    }),
    updatePlan: useMutation({
      mutationFn: ({ id, body }: { id: string; body: z.input<typeof PlanBody> }) =>
        client.request('PUT', `/platform/v1/plans/${id}`, PlanResult, body),
      // A plan's tenants follow it at once.
      onSuccess: () => refresh(['plans', 'entitlements']),
    }),
    setPlan: useMutation({
      mutationFn: ({
        tenantId,
        body,
      }: {
        tenantId: string;
        body: z.input<typeof TenantPlanBody>;
      }) =>
        client.request('PUT', `/platform/v1/tenants/${tenantId}/plan`, TenantEntitlements, body),
      onSuccess: () => refresh(['entitlements', 'tenant', 'tenants', 'plans']),
    }),
    invite: useMutation({
      mutationFn: (body: { id: string; email: string; name: string; role: string }) =>
        client.request('POST', '/platform/v1/staff', InviteStaffResult, body),
      onSuccess: () => refresh(['staff']),
    }),
    disable: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/staff/${id}/disable`, StaffResult),
      onSuccess: () => refresh(['staff']),
    }),
  };
}
