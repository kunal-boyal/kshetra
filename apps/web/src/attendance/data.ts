import {
  AttendanceRegisterResult,
  type DayStatusKey,
  LeaveRequestListResult,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApp } from '../context';
import { read } from '../people/data';

/** Everyone the viewer sees by days of a month, a page of people at a time (decision D104). */
export function useRegister(period: string, territoryId: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['attendance-register', period, territoryId],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ period });
      if (territoryId) query.set('territoryId', territoryId);
      if (pageParam) query.set('cursor', pageParam);
      return read(client, `/v1/attendance/register?${query}`, AttendanceRegisterResult);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The leave of everyone the viewer sees that takes in a day of the month. */
export function useTeamLeave(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['leave-requests', 'team', period],
    queryFn: () =>
      read(client, `/v1/leave-requests?team=true&period=${period}`, LeaveRequestListResult),
  });
}

/** The register's letters: what each day status reads as, and its tone. */
export const LETTERS = ['present', 'half_day', 'leave', 'absent', 'off'] as const;
export type Letter = (typeof LETTERS)[number];

export function letterOf(status: DayStatusKey): Letter | null {
  switch (status) {
    case 'present':
      return 'present';
    case 'half_day':
      return 'half_day';
    case 'paid_leave':
    case 'unpaid_leave':
      return 'leave';
    case 'absent':
      return 'absent';
    case 'holiday':
    case 'weekly_off':
      return 'off';
    case 'future':
    case 'not_employed':
      return null;
  }
}

export const LETTER_TONE: Record<Letter, string> = {
  present: 'text-[var(--success-fg)] bg-[var(--success-bg)] border-[var(--success-border)]',
  half_day: 'text-[var(--pending-fg)] bg-[var(--pending-bg)] border-[var(--pending-border)]',
  leave: 'text-[var(--info-fg)] bg-[var(--info-bg)] border-[var(--info-border)]',
  absent: 'text-[var(--danger-fg)] bg-[var(--danger-bg)] border-[var(--danger-border)]',
  off: 'text-[var(--neutral-fg)] bg-[var(--neutral-bg)] border-[var(--neutral-border)]',
};
