import {
  AccountReceiptListResult,
  CollectionDecisionsResult,
  CollectionListResult,
  CollectionResult,
  type CollectionStatusKey,
} from '@thelamp/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

/**
 * Collections on the web (M11, BR-63, decision D132): the list the office works through, one
 * collection, and the office's decisions, after which every list and the account's finance read
 * again.
 */

export interface CollectionFilters {
  status?: CollectionStatusKey;
  accountId?: string;
  /** A month on the tenant's clock. */
  period?: string;
}

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Collections the viewer sees, newest first, a page at a time. */
export function useCollections(filters: CollectionFilters, enabled = true) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['collections', filters],
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/collections${search({ ...filters, cursor: pageParam })}`,
        CollectionListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function useCollection(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['collection', id],
    queryFn: () => read(client, `/v1/collections/${id}`, CollectionResult),
  });
}

/** The account's receipts from the books, for matching a collection to one by hand. */
export function useAccountReceipts(accountId: string, enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-receipts', accountId],
    queryFn: () =>
      read(client, `/v1/accounts/${accountId}/receipts?limit=200`, AccountReceiptListResult),
    enabled,
  });
}

/** The office's decisions on collections (BR-63), each sent with a fresh idempotency key. */
export function useCollectionWrites() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all(
      ['collections', 'collection', 'finance', 'account-receipts'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const after = async <T>(done: Promise<T>) => {
    const result = await done;
    await refresh();
    return result;
  };
  return {
    decide: (items: { id: string; decision: 'confirm' | 'reject'; reason?: string }[]) =>
      after(
        write(client, 'POST', '/v1/collections/decisions', CollectionDecisionsResult, {
          items,
        }).then((answer) => answer ?? { results: [] }),
      ),
    bounce: (id: string, reason: string) =>
      after(write(client, 'POST', `/v1/collections/${id}/bounce`, CollectionResult, { reason })),
    match: (id: string, receiptId: string) =>
      after(write(client, 'POST', `/v1/collections/${id}/match`, CollectionResult, { receiptId })),
    unmatch: (id: string) =>
      after(write(client, 'POST', `/v1/collections/${id}/unmatch`, CollectionResult)),
  };
}
