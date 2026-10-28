import {
  ApprovalInboxResult,
  ApprovalPreviewResult,
  ApprovalResult,
  newId,
  type RequestType,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

/**
 * Approvals on the phone (M15, decision D76): managers read what waits for them and decide online,
 * one request at a time, as they review submissions (decision D52). Nothing is kept offline.
 */

const INBOX_KEY = ['approvals', 'inbox'] as const;

/**
 * Requests waiting for the person's decision, oldest first, a page at a time; of one type when
 * given, with the counts of every type whatever the filter.
 */
export function useApprovalInbox(type?: RequestType, enabled = true) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: [...INBOX_KEY, type ?? 'all'],
    enabled,
    queryFn: async ({ pageParam }) =>
      (await client.request(
        'GET',
        `/v1/approvals/inbox?limit=30${type ? `&requestType=${type}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ApprovalInboxResult,
      ))!,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One request from the inbox; undefined once it no longer waits for the person. */
export function useWaitingRequest(id: string): {
  item: ApprovalResult | undefined;
  loading: boolean;
} {
  const inbox = useApprovalInbox();
  return {
    item: inbox.data?.pages.flatMap((page) => page.items).find((entry) => entry.id === id),
    loading: inbox.isPending,
  };
}

/** Approves, or rejects with a reason, at the version the person saw; the inbox reads again. */
export function useDecideRequest() {
  const { client, queryClient } = useApp();
  return async (item: ApprovalResult, decision: 'approve' | 'reject', note?: string) => {
    const result = await client.request(
      'POST',
      `/v1/approvals/${item.id}/decision`,
      ApprovalResult,
      {
        body: { decision, version: item.version, ...(note?.trim() ? { note: note.trim() } : {}) },
        idempotencyKey: newId(),
      },
    );
    await queryClient.invalidateQueries({ queryKey: INBOX_KEY });
    return result!;
  };
}

/**
 * Who would decide a request of this type from the person, with these facts, as the server would
 * route it (decision D104); read online, and quietly absent without a signal.
 */
export function useApprovalPreview(
  requestType: RequestType,
  facts: Readonly<Record<string, string | number | boolean>>,
) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['approval-preview', requestType, facts],
    queryFn: async () =>
      (await client.request('POST', '/v1/approvals/preview', ApprovalPreviewResult, {
        body: { requestType, facts },
      }))!,
    retry: false,
    staleTime: 60_000,
  });
}
