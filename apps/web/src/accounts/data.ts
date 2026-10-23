import type { AccountTypeView } from '@thelamp/forms';
import { AccountListResult, AccountOverview, type AccountStatus } from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { useConfig } from '../data';
import { read } from '../people/data';

/** The tenant's account types, as the config bundle carries them (spec 5.5). */
export function useAccountTypes(): AccountTypeView[] | undefined {
  const { client, queryClient } = useApp();
  return useConfig(client, queryClient).data?.bundle.accountTypes;
}

export interface AccountFilters {
  type: string;
  q?: string;
  status?: AccountStatus;
  segment?: string;
}

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The accounts the viewer sees, a type at a time, a page at a time. */
export function useAccounts(filters: AccountFilters, enabled = true, limit = 50) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['accounts', filters, limit],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/accounts${search({ ...filters, limit: String(limit), cursor: pageParam })}`,
        AccountListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function useAccountOverview(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account', id],
    queryFn: () => read(client, `/v1/accounts/${id}/overview`, AccountOverview),
  });
}

/** After a change to accounts, everything that shows them reads again. */
export function useRefreshAccounts() {
  const queryClient = useQueryClient();
  return (id?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      ...(id ? [queryClient.invalidateQueries({ queryKey: ['account', id] })] : []),
    ]);
}
