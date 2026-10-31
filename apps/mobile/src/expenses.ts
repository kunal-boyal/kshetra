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
  ShiftListResult,
  todayIn,
  trackedKm,
  unscaled,
} from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './app-state';
import { useKept } from './data';
import type { Kept } from './performance';
import { useOutboxItems, useSync } from './sync';

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
 * phone leaves their amount to it, as it does a tracked per-km claim whose distance it doesn't
 * know yet (`trackedKm` undefined; null when the day has no ended shift, decision D115).
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
  trackedKm?: string | null | undefined;
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
  const tracked = policy.calculation === 'per_km' && policy.kmFrom === 'tracked';
  const unknown = perVisit || (tracked && input.trackedKm === undefined);
  const base = unknown
    ? null
    : claimBase({
        calculation: policy.calculation,
        kmFrom: policy.kmFrom,
        trackedKm: input.trackedKm,
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
    // A distance the phone doesn't know yet is the server's to judge.
    trackedKm: input.trackedKm === undefined ? '1.00' : input.trackedKm,
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
  // Visits and tracked distance are the server's to count.
  const amount =
    policy && policy.calculation !== 'per_visit' && policy.kmFrom !== 'tracked'
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

/** What the phone knows of a day's tracked distance for a claim (decision D115). */
export interface DayDistance {
  /** Kilometres, null without an ended shift that day, undefined while it isn't known. */
  trackedKm: string | null | undefined;
  /** A shift of the day is still open on the phone. */
  open: boolean;
  /** The punch-out uploads a claim from the day's distance waits for. */
  uploads: string[];
}

/**
 * The day's tracked distance, from the person's own shifts read online, checked against the
 * shifts punched on this phone: while a punch-out or a shift's distance hasn't reached the server,
 * the distance isn't known and the server works it out when the claim arrives.
 */
export function useDayDistance(day: string, timezone: string, enabled: boolean): DayDistance {
  const { client } = useApp();
  const sync = useSync();
  const owner = client.owner;
  const [local, setLocal] = useState<{ shiftId: string; closeUploadId: string | null }[]>();
  useEffect(() => {
    if (!sync || !owner || !enabled) return;
    let live = true;
    void sync.tracking.dayShifts(owner, day).then((shifts) => {
      if (live) setLocal(shifts);
    });
    return () => {
      live = false;
    };
  }, [sync, owner, day, enabled]);
  const userId = owner?.split(':')[1];
  const shifts = useQuery({
    queryKey: ['own-shifts', userId],
    queryFn: async () =>
      (await client.request('GET', `/v1/shifts?userId=${userId}&limit=30`, ShiftListResult))!.items,
    enabled: enabled && userId !== undefined,
  });
  const mine = local ?? [];
  const uploads = mine.flatMap((shift) => (shift.closeUploadId ? [shift.closeUploadId] : []));
  const open = mine.some((shift) => shift.closeUploadId === null);
  if (!shifts.data) return { trackedKm: undefined, open, uploads };
  const dayOf = (shift: { startedAt: string }) => todayIn(timezone, new Date(shift.startedAt));
  const onDay = shifts.data.filter((shift) => dayOf(shift) === day);
  // The newest 30 shifts may not reach back to the day; then only the server can tell.
  const oldest = shifts.data.at(-1);
  const reaches = shifts.data.length < 30 || (oldest !== undefined && dayOf(oldest) < day);
  const settled =
    reaches &&
    onDay.every((shift) => shift.endedAt !== null && shift.distanceM !== null) &&
    mine.every((shift) => onDay.some((known) => known.id === shift.shiftId));
  if (!settled) return { trackedKm: undefined, open, uploads };
  if (onDay.length === 0) return { trackedKm: null, open, uploads };
  const metres = onDay.reduce((total, shift) => total + (shift.distanceM ?? 0), 0);
  return { trackedKm: trackedKm(metres), open, uploads };
}
