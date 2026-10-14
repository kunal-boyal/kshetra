import {
  MediaUrlResult,
  newId,
  type ReviewDecision,
  ReviewItem,
  ReviewQueueResult,
} from '@kshetra/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';

/**
 * Review on the phone (M7, decision D52): managers read the queue and decide online; nothing is
 * kept offline, as a decision weighs the evidence as it stands on the server.
 */

const QUEUE_KEY = ['review-queue', 'pending'] as const;

/** Submissions waiting for the person's review, newest first, a page at a time. */
export function useReviewQueue() {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: QUEUE_KEY,
    queryFn: async ({ pageParam }) =>
      (await client.request(
        'GET',
        `/v1/reviews/queue?status=pending&limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ReviewQueueResult,
      ))!,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One submission from the queue, read if the phone hasn't yet; undefined while it loads. */
export function useQueuedItem(id: string): { item: ReviewItem | undefined; loading: boolean } {
  const queue = useReviewQueue();
  return {
    item: queue.data?.pages.flatMap((page) => page.items).find((entry) => entry.id === id),
    loading: queue.isPending,
  };
}

/** Approves or rejects one submission; the queue reads again after. */
export function useDecide() {
  const { client, queryClient } = useApp();
  return async (id: string, decision: ReviewDecision, note?: string) => {
    const result = await client.request('POST', `/v1/submissions/${id}/review`, ReviewItem, {
      body: { decision, ...(note?.trim() ? { note: note.trim() } : {}) },
      idempotencyKey: newId(),
    });
    await queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    return result!;
  };
}

/** A short-lived link to a photo's thumbnail. */
export function usePhotoLink(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['photo-link', id],
    queryFn: async () =>
      (await client.request('GET', `/v1/media/${id}/url?variant=thumbnail`, MediaUrlResult))!,
    staleTime: 4 * 60_000,
    retry: false,
  });
}
