import type { Outbox, SqlDatabase } from '@thelamp/api-client/sync';
import {
  type AttendanceDayResult,
  AttendanceResult,
  type CreateRegularisationBody,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useApp } from './app-state';
import { useKept } from './data';
import type { Kept } from './performance';
import { useOutboxItems } from './sync';

/**
 * Attendance on the phone (M13, decision D80): the person's own month of days, kept on the phone
 * with when it was read, and fixing a past day, which queues like any capture so it waits for a
 * signal.
 */

export const FIX_KIND = 'regularisation.create';

/** The person's own month, kept on the phone. */
export function useMyAttendance(period: string) {
  const { client } = useApp();
  return useKept<Kept<AttendanceResult>>(`attendance:${period}`, async () => {
    // The phone's owner is `tenant:user`, known offline too.
    const userId = client.owner?.split(':')[1];
    return {
      data: (await client.request(
        'GET',
        `/v1/attendance?userId=${userId}&period=${period}`,
        AttendanceResult,
      ))!,
      readAt: new Date().toISOString(),
    };
  });
}

/** Requests to fix a day still on the phone, by date. */
export function useQueuedFixes(): ReadonlyMap<string, CreateRegularisationBody> {
  const items = useOutboxItems();
  return useMemo(
    () =>
      new Map(
        items
          .filter((item) => item.kind === FIX_KIND)
          .map((item) => {
            const body = item.payload as CreateRegularisationBody;
            return [body.date, body] as const;
          }),
      ),
    [items],
  );
}

/**
 * Whether a day can be asked about (BR-28, as the server judges it): a day that has passed or is
 * today, while employed, not already present, with no request waiting or approved, here or on the
 * server. What remains, such as the reason, the server checks.
 */
export function fixable(day: AttendanceDayResult, queued: boolean): boolean {
  if (queued) return false;
  if (day.status === 'future' || day.status === 'not_employed' || day.status === 'present') {
    return false;
  }
  // The server shows only a waiting or approved request; a refused one frees the day.
  return day.regularisation === null;
}

/** Saves a request to fix a day on the phone and queues it, in one transaction. */
export async function queueFix(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  body: CreateRegularisationBody,
): Promise<void> {
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, { id: body.id, owner, kind: FIX_KIND, payload: body });
  });
}
