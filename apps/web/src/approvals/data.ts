import {
  ApprovalDelegation,
  ApprovalInboxResult,
  ApprovalMineResult,
  ApprovalResult,
  type ApprovalStatus,
  BulkApprovalResult,
  type CreateDelegationBody,
  DelegationCandidatesResult,
  DelegationListResult,
  type RequestType,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

function search(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** What waits for the viewer to decide, oldest first, with how many of each type wait in all. */
export function useInbox(requestType?: RequestType) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['approvals', 'inbox', requestType ?? null],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/approvals/inbox${search({ requestType, cursor: pageParam })}`,
        ApprovalInboxResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** What the viewer asked for, newest first. */
export function useMine(status?: ApprovalStatus) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['approvals', 'mine', status ?? null],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/approvals/mine${search({ status, cursor: pageParam })}`,
        ApprovalMineResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Decisions, and what they change: the approvals themselves, and the accounts and plans a decision
 * applies to.
 */
export function useDecisions() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all(
      ['approvals', 'accounts', 'account', 'plan', 'dashboard'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  return {
    async decide(item: ApprovalResult, decision: 'approve' | 'reject', note?: string) {
      await write(client, 'POST', `/v1/approvals/${item.id}/decision`, ApprovalResult, {
        decision,
        version: item.version,
        ...(note === undefined ? {} : { note }),
      });
      await refresh();
    },
    async approveMany(items: readonly ApprovalResult[]) {
      const result = await write(client, 'POST', '/v1/approvals/decisions', BulkApprovalResult, {
        items: items.map((item) => ({ id: item.id, version: item.version })),
      });
      await refresh();
      if (!result) throw new Error('/v1/approvals/decisions answered without a body.');
      return result;
    },
    async withdraw(item: ApprovalResult) {
      await write(client, 'POST', `/v1/approvals/${item.id}/cancel`, ApprovalResult);
      await refresh();
    },
  };
}

/** The viewer's delegations, given and received (decision D113). */
export function useDelegations() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['approvals', 'delegations'],
    queryFn: () => read(client, '/v1/approval-delegations', DelegationListResult),
  });
}

/** The people who may approve, to hand over to. */
export function useDelegateCandidates() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['approvals', 'delegation-candidates'],
    queryFn: () => read(client, '/v1/approval-delegations/candidates', DelegationCandidatesResult),
  });
}

/** Handing over and ending a handover; the inbox reads again after either. */
export function useDelegationChanges() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['approvals'] });
  return {
    async hand(body: CreateDelegationBody) {
      await write(client, 'POST', '/v1/approval-delegations', ApprovalDelegation, body);
      await refresh();
    },
    async end(id: string) {
      await write(client, 'POST', `/v1/approval-delegations/${id}/end`, ApprovalDelegation);
      await refresh();
    },
  };
}
