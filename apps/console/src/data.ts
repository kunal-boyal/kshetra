import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CellListResult,
  ConsoleTenant,
  ConsoleTenantList,
  CreateTenantBody,
  InviteStaffResult,
  StaffListResult,
  StaffResult,
  TemplateListResult,
  type TenantStatusSchema,
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
      onSuccess: () => refresh(['tenants', 'cells']),
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
