import {
  AccountPricesResult,
  type FulfilmentBody,
  type LineDecisionsBody,
  type OrderDecisionBody,
  OrderListResult,
  OrderResult,
  type OrderStatus,
  type PlaceOrderBody,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

export interface OrderFilters {
  status?: OrderStatus;
  from?: string;
  to?: string;
}

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The orders the viewer sees, newest first, a page at a time. */
export function useOrders(filters: OrderFilters) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['orders', filters],
    queryFn: ({ pageParam }) =>
      read(client, `/v1/orders${search({ ...filters, cursor: pageParam })}`, OrderListResult),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOrder(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => read(client, `/v1/orders/${id}`, OrderResult),
  });
}

/** What each item costs at an account today, for the order desk. */
export function useAccountPrices(accountId: string | undefined) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-prices', accountId],
    queryFn: () => read(client, `/v1/accounts/${accountId}/prices`, AccountPricesResult),
    enabled: accountId !== undefined,
  });
}

/** Changes to orders; the orders, the inbox and the home figures read again after. */
export function useOrderWrites() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all(
      ['orders', 'order', 'approvals', 'dashboard'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const after = async <T>(done: Promise<T>) => {
    const result = await done;
    await refresh();
    return result;
  };
  return {
    // The order's own ID makes placing it safe to repeat.
    place: (body: Omit<PlaceOrderBody, 'visitId' | 'photos' | 'fix'>) =>
      after(client.request('POST', '/v1/orders', OrderResult, { body })),
    decide: (id: string, body: OrderDecisionBody) =>
      after(write(client, 'POST', `/v1/orders/${id}/decision`, OrderResult, body)),
    decideLines: (id: string, body: LineDecisionsBody) =>
      after(write(client, 'POST', `/v1/orders/${id}/line-decisions`, OrderResult, body)),
    fulfil: (id: string, body: FulfilmentBody) =>
      after(write(client, 'POST', `/v1/orders/${id}/fulfilment`, OrderResult, body)),
  };
}
