import type { Outbox, SqlDatabase } from '@thelamp/api-client/sync';
import {
  type CalendarResult,
  CalendarListResult,
  type CreateLeaveRequestBody,
  LeaveBalanceResult,
  type LeaveIssue,
  leaveDays,
  leaveIssues,
  type LeaveRequestResult,
  LeaveRequestListResult,
  type LeaveType,
  LeaveTypeListResult,
  quotaYear,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useApp } from './app-state';
import { useKept } from './data';
import type { Kept } from './performance';
import { useOutboxItems } from './sync';

/**
 * Leave on the phone (M13, decision D81): the tenant's leave types, the person's balances and
 * requests, and the holiday calendars to count working days with, all kept on the phone with
 * when they were read. Asking for leave queues like any capture, so it waits for a signal; the
 * phone previews the server's count and refusals (BR-27) from what it keeps.
 */

export const LEAVE_KIND = 'leave_request.create';

export function useLeaveTypes() {
  const { client } = useApp();
  return useKept<LeaveType[]>(
    'leave-types',
    async () => (await client.request('GET', '/v1/leave-types', LeaveTypeListResult))!.items,
  );
}

export function useLeaveBalances() {
  const { client } = useApp();
  return useKept<Kept<LeaveBalanceResult>>('leave-balances', async () => ({
    data: (await client.request('GET', '/v1/leave-balances', LeaveBalanceResult))!,
    readAt: new Date().toISOString(),
  }));
}

/** The person's own requests starting in a year. */
export function useMyLeave(year: string) {
  const { client } = useApp();
  return useKept<LeaveRequestResult[]>(
    `leave-requests:${year}`,
    async () =>
      (await client.request('GET', `/v1/leave-requests?year=${year}`, LeaveRequestListResult))!
        .items,
  );
}

/** The tenant's holiday calendars with a year's holidays. */
export function useCalendars(year: string) {
  const { client } = useApp();
  return useKept<CalendarResult[]>(
    `calendars:${year}`,
    async () =>
      (await client.request('GET', `/v1/calendars?year=${year}`, CalendarListResult))!.items,
  );
}

/** Requests for leave still on the phone. */
export function useQueuedLeave(): CreateLeaveRequestBody[] {
  const items = useOutboxItems();
  return useMemo(
    () =>
      items
        .filter((item) => item.kind === LEAVE_KIND)
        .map((item) => item.payload as CreateLeaveRequestBody),
    [items],
  );
}

/**
 * Whether a date is off on the person's calendar, the one they keep or the default: a weekly off
 * or an active holiday that isn't optional, as the server counts (BR-27).
 */
export function offDays(
  calendars: readonly CalendarResult[],
  calendarKey: string | null,
): (date: string) => boolean {
  const calendar =
    calendars.find((entry) => entry.key === calendarKey) ??
    calendars.find((entry) => entry.default);
  if (!calendar) return () => false;
  const offs = new Set(calendar.weeklyOffs);
  const holidays = new Set(
    calendar.holidays.filter((holiday) => !holiday.optional).map((holiday) => holiday.date),
  );
  return (date) => offs.has(new Date(`${date}T00:00:00Z`).getUTCDay() || 7) || holidays.has(date);
}

/** What the phone knows of the person's requests: on the server and still queued. */
export interface Asked {
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

/**
 * The phone's preview of a request (BR-27): its working days and what the server would refuse,
 * judged against the requests the phone knows of, waiting or approved, queued ones included.
 */
export function previewLeave(input: {
  type: LeaveType;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  hasAttachment: boolean;
  isOff: (date: string) => boolean;
  asked: readonly Asked[];
  financialYearStartMonth: number;
}): { days: number; issues: LeaveIssue[] } {
  const { type, startDate, endDate, halfDay } = input;
  const days =
    endDate < startDate ? 0 : leaveDays({ start: startDate, end: endDate, halfDay }, input.isOff);
  const open = input.asked.filter(
    (entry) => entry.state === 'pending' || entry.state === 'approved',
  );
  const year = quotaYear(startDate, type.quotaYear, input.financialYearStartMonth);
  const used = open
    .filter(
      (entry) =>
        entry.leaveType === type.key && entry.startDate >= year.from && entry.startDate <= year.to,
    )
    .reduce((sum, entry) => sum + entry.days, 0);
  const overlaps = open.some((entry) => entry.startDate <= endDate && entry.endDate >= startDate);
  return {
    days,
    issues: leaveIssues({
      start: startDate,
      end: endDate,
      halfDay,
      days,
      hasAttachment: input.hasAttachment,
      type,
      used,
      overlaps,
    }),
  };
}

/** Saves a request for leave on the phone and queues it, after any document photo. */
export async function queueLeave(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  body: CreateLeaveRequestBody,
): Promise<void> {
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: body.id,
      owner,
      kind: LEAVE_KIND,
      payload: body,
      ...(body.attachmentId ? { dependsOn: [body.attachmentId] } : {}),
    });
  });
}
