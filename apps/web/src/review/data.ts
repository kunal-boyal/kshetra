import { MediaUrlResult, ReviewQueueResult, ReviewRulesResult } from '@kshetra/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** What the queue is filtered by; empty values are left out. */
export interface QueueFilters {
  status: 'pending' | 'approved' | 'rejected';
  formKey?: string;
  flag?: string;
  geofence?: string;
  from?: string;
  to?: string;
}

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The review queue (M7), newest first, a page at a time. */
export function useReviewQueue(filters: QueueFilters) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['review-queue', filters],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/reviews/queue${search({ ...filters, cursor: pageParam })}`,
        ReviewQueueResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useReviewRules(enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['review-rules'],
    queryFn: () => read(client, '/v1/review-rules', ReviewRulesResult),
    enabled,
  });
}

/** A short-lived link to a photo's thumbnail; read again before it lapses. */
export function usePhotoLink(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['photo-link', id],
    queryFn: () => read(client, `/v1/media/${id}/url?variant=thumbnail`, MediaUrlResult),
    staleTime: 4 * 60_000,
    retry: false,
  });
}

/** After a decision, the queue and every list of submissions read again. */
export function useRefreshReview() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['submissions'] }),
    ]);
}
