import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RecordStockResult,
  StockCountList,
  StockCountResult,
  StockLevelsResult,
  StockMovementList,
} from '@thelamp/shared';
import { useApp } from '../context';
import { read, write } from '../people/data';

/** An account's stock, item by item, and where it comes from (BR-62, decision D130). */
export function useStock(accountId: string | null, enabled = true) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['stock', accountId],
    queryFn: () => read(client, `/v1/accounts/${accountId}/stock`, StockLevelsResult),
    enabled: enabled && accountId !== null,
  });
}

/** An account's movements, newest first, a page at a time. */
export function useStockMovements(accountId: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['stock', accountId, 'movements'],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/accounts/${accountId}/stock/movements${pageParam ? `?cursor=${pageParam}` : ''}`,
        StockMovementList,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** An account's counts, newest first, a page at a time. */
export function useStockCounts(accountId: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['stock', accountId, 'counts'],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/accounts/${accountId}/stock/counts${pageParam ? `?cursor=${pageParam}` : ''}`,
        StockCountList,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Entries and counts, each with the client's ID, refreshing the account's stock after. */
export function useStockWrites(accountId: string) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['stock', accountId] });
  return {
    async record(body: unknown) {
      const result = await write(client, 'POST', '/v1/stock/movements', RecordStockResult, body);
      await refresh();
      return result;
    },
    async count(body: unknown) {
      const result = await write(client, 'POST', '/v1/stock/counts', StockCountResult, body);
      await refresh();
      return result;
    },
  };
}
