import { UserFieldsResult } from '@thelamp/forms';
import {
  AuditListResult,
  DesignationListResult,
  newId,
  OrgChartResult,
  RoleListResult,
  type TenantPermission,
  TerritoryListResult,
  TransferListResult,
  UserListResult,
  UserView,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import type { WebClient } from '../client';
import { useApp } from '../context';
import { useConfig } from '../data';

/** A read that always answers with a body. */
export async function read<T extends z.ZodType>(
  client: WebClient,
  path: string,
  schema: T,
): Promise<z.output<T>> {
  const body = await client.request('GET', path, schema);
  if (body === undefined) throw new Error(`${path} answered without a body.`);
  return body;
}

/** A change, with a fresh idempotency key: the API applies a retried one once (BR-46). */
export function write<T extends z.ZodType>(
  client: WebClient,
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  schema: T,
  body?: unknown,
) {
  return client.request(method, path, schema, {
    ...(body === undefined ? {} : { body }),
    idempotencyKey: newId(),
  });
}

/** For changes that answer 204 with no body. */
export const NOTHING = z.unknown();

/** What the signed-in person may do, from the config bundle. */
export function useAccess() {
  const { client, queryClient } = useApp();
  const config = useConfig(client, queryClient);
  return useMemo(() => {
    const permissions = new Set<TenantPermission>(config.data?.bundle.access.permissions ?? []);
    return {
      ready: config.data !== undefined,
      can: (permission: TenantPermission) => permissions.has(permission),
      scope: config.data?.bundle.access.scope,
      timezone: config.data?.bundle.settings.timezone ?? 'Asia/Kolkata',
      currency: config.data?.bundle.settings.currency ?? 'INR',
      designations: config.data?.bundle.designations ?? [],
      /** Modules the tenant switched off: their screens hide (D64). */
      modulesOff: config.data?.bundle.settings.modulesOff ?? [],
    };
  }, [config.data]);
}

export interface UserFilters {
  q?: string;
  status?: 'active' | 'inactive';
  designation?: string;
  managerId?: string;
}

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The people table, a page at a time (spec 8.2). */
export function useUsers(filters: UserFilters, limit = 50) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['users', filters, limit],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/users${search({ ...filters, limit: String(limit), cursor: pageParam })}`,
        UserListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useUser(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => read(client, `/v1/users/${id}`, UserView),
  });
}

export function useTransfers(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['transfers', id],
    queryFn: () => read(client, `/v1/users/${id}/transfers`, TransferListResult),
  });
}

export function useHistory(id: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['history', id],
    queryFn: ({ pageParam }) =>
      read(client, `/v1/users/${id}/history${search({ cursor: pageParam })}`, AuditListResult),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One level of the organisation chart: someone's direct reports, or the top. */
export function useOrgChart(managerId?: string, enabled = true) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['org-chart', managerId ?? 'top'],
    queryFn: () => read(client, `/v1/org-chart${search({ managerId })}`, OrgChartResult),
    enabled,
  });
}

export function useTerritories() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['territories'],
    queryFn: async () => (await read(client, '/v1/territories', TerritoryListResult)).items,
  });
}

export function useUserFields() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['user-fields'],
    queryFn: () => read(client, '/v1/user-fields', UserFieldsResult),
  });
}

export function useRoles() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await read(client, '/v1/roles', RoleListResult)).items,
  });
}

export function useDesignations() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['designations'],
    queryFn: async () => (await read(client, '/v1/designations', DesignationListResult)).items,
  });
}

/** After a change to people, everything that shows them reads again. */
export function useRefreshPeople() {
  const queryClient = useQueryClient();
  return (id?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['org-chart'] }),
      ...(id
        ? [
            queryClient.invalidateQueries({ queryKey: ['user', id] }),
            queryClient.invalidateQueries({ queryKey: ['transfers', id] }),
            queryClient.invalidateQueries({ queryKey: ['history', id] }),
          ]
        : []),
    ]);
}
