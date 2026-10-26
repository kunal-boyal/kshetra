import type { Outbox, SqlDatabase } from '@thelamp/api-client/sync';
import {
  capClaim,
  claimBase,
  claimIssues,
  type CreateExpenseClaimBody,
  type ExpenseClaimResult,
  ExpenseClaimListResult,
  type ExpenseIssue,
  type ExpensePolicyResult,
  ExpensePolicyListResult,
  newId,
  rateFor,
  scaled,
  unscaled,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useApp } from './app-state';
import { useKept } from './data';
import type { Kept } from './performance';
import { useOutboxItems } from './sync';

/**
 * Expenses on the phone (M12, decision D83): the tenant's policies and the person's claims of a
 * month, kept on the phone with when they were read. A claim queues like any capture, after its
 * photos, and so do receipts added to a waiting claim; the phone previews what the server will
 * make of a claim (BR-29) from what it keeps.
 */

export const CLAIM_KIND = 'expense_claim.create';
export const RECEIPTS_KIND = 'expense_claim.receipts';

/** Receipts for a claim already sent, waiting to upload. */
export interface ReceiptsPayload {
  claimId: string;
  mediaIds: string[];
}

export function useExpensePolicies() {
  const { client } = useApp();
  return useKept<ExpensePolicyResult[]>(
    'expense-policies',
    async () =>
      (await client.request('GET', '/v1/expense-policies', ExpensePolicyListResult))!.items,
  );
}

/** The person's own claims for days in a month. */
export function useMyClaims(period: string) {
  const { client } = useApp();
  return useKept<Kept<ExpenseClaimResult[]>>(`expense-claims:${period}`, async () => {
    // The phone's owner is `tenant:user`, known offline too.
    const userId = client.owner?.split(':')[1];
    return {
      data: (await client.request(
        'GET',
        `/v1/expense-claims?userId=${userId}&period=${period}&limit=100`,
        ExpenseClaimListResult,
      ))!.items,
      readAt: new Date().toISOString(),
    };
  });
}

/** Claims and receipts still on the phone. */
export function useQueuedExpenses(): {
  claims: CreateExpenseClaimBody[];
  receipts: ReceiptsPayload[];
} {
  const items = useOutboxItems();
  return useMemo(
    () => ({
      claims: items
        .filter((item) => item.kind === CLAIM_KIND)
        .map((item) => item.payload as CreateExpenseClaimBody),
      receipts: items
        .filter((item) => item.kind === RECEIPTS_KIND)
        .map((item) => item.payload as ReceiptsPayload),
    }),
    [items],
  );
}

/** A claim the phone knows of, sent or queued, as caps count it. */
export interface Claimed {
  policy: string;
  expenseDate: string;
  amount: string;
  state: string;
}

const sum = (amounts: readonly string[]) =>
  unscaled(
    amounts.reduce((total, amount) => total + scaled(amount, 2), 0n),
    2,
  );

/**
 * The phone's preview of a claim (BR-29): what it comes to before and after caps, and what the
 * server would refuse. Per-visit claims are counted by the server from the day's visits, so the
 * phone leaves their amount to it.
 */
export function previewClaim(input: {
  policy: ExpensePolicyResult;
  designation: string;
  expenseDate: string;
  today: string;
  days?: string | undefined;
  odometerOpen?: string | undefined;
  odometerClose?: string | undefined;
  billAmount?: string | undefined;
  odometerPhotos: number;
  claimed: readonly Claimed[];
}): { calculated: string | null; amount: string | null; capped: boolean; issues: ExpenseIssue[] } {
  const { policy } = input;
  const rate = policy.calculation === 'actual' ? null : rateFor(policy.rate, input.designation);
  const valid = (text: string | undefined, places: number) => {
    if (text === undefined) return undefined;
    try {
      scaled(text, places);
      return text;
    } catch {
      return undefined;
    }
  };
  const days = valid(input.days, 3);
  const odometerOpen = valid(input.odometerOpen, 2);
  const odometerClose = valid(input.odometerClose, 2);
  const billAmount = valid(input.billAmount, 2);
  const perVisit = policy.calculation === 'per_visit';
  const base = perVisit
    ? null
    : claimBase({
        calculation: policy.calculation,
        rate,
        days,
        odometerOpen,
        odometerClose,
        billAmount,
      });
  const counted = input.claimed.filter(
    (claim) =>
      claim.policy === policy.key &&
      ['pending', 'approved', 'paid'].includes(claim.state) &&
      claim.expenseDate.slice(0, 7) === input.expenseDate.slice(0, 7),
  );
  const capped = base
    ? capClaim(base.amount, policy.caps, {
        day: sum(
          counted
            .filter((claim) => claim.expenseDate === input.expenseDate)
            .map((claim) => claim.amount),
        ),
        month: sum(counted.map((claim) => claim.amount)),
      })
    : null;
  const issues = claimIssues({
    policy,
    rate,
    expenseDate: input.expenseDate,
    today: input.today,
    days,
    odometerOpen,
    odometerClose,
    odometerPhotos: input.odometerPhotos,
    billAmount,
    // The server counts the visits; the phone assumes there were some.
    visits: perVisit ? 1 : undefined,
    amount: capped?.amount ?? '1',
  });
  return {
    calculated: base?.amount ?? null,
    amount: capped?.amount ?? null,
    capped: capped?.capped ?? false,
    issues,
  };
}

/** A queued claim as caps count it: worked out by its policy, before caps, as the phone can. */
export function queuedClaim(
  claim: CreateExpenseClaimBody,
  policies: readonly ExpensePolicyResult[],
  designation: string,
): Claimed {
  const policy = policies.find((entry) => entry.key === claim.policy);
  const amount =
    policy && policy.calculation !== 'per_visit'
      ? claimBase({
          calculation: policy.calculation,
          rate: policy.calculation === 'actual' ? null : rateFor(policy.rate, designation),
          days: claim.days,
          odometerOpen: claim.odometerOpen,
          odometerClose: claim.odometerClose,
          billAmount: claim.billAmount,
        }).amount
      : '0';
  return { policy: claim.policy, expenseDate: claim.expenseDate, amount, state: 'pending' };
}

/**
 * Saves a claim on the phone and queues it, after its photos, and after any other upload it needs
 * first, such as the punch-out whose readings it begins from (decision D99).
 */
export async function queueClaim(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  body: CreateExpenseClaimBody,
  after: readonly string[] = [],
): Promise<void> {
  const photos = [...body.receiptIds, ...body.odometerPhotoIds, ...after];
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: body.id,
      owner,
      kind: CLAIM_KIND,
      payload: body,
      ...(photos.length > 0 ? { dependsOn: photos } : {}),
    });
  });
}

/** Queues receipts for a claim already sent, after the photos and any claim still queued. */
export async function queueReceipts(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  payload: ReceiptsPayload,
): Promise<void> {
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: newId(),
      owner,
      kind: RECEIPTS_KIND,
      payload,
      dependsOn: [...payload.mediaIds, payload.claimId],
    });
  });
}
