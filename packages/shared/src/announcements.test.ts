import { describe, expect, it } from 'vitest';
import { announcementStatus, announcementWindowIssue } from './announcements';

const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, '0')}T04:30:00Z`);

describe('announcements (M22, decision D93)', () => {
  it('waits to start, shows, then ends; withdrawn wins', () => {
    const window = { startsAt: at(2), endsAt: at(4), withdrawnAt: null };
    expect(announcementStatus(window, at(1))).toBe('scheduled');
    expect(announcementStatus(window, at(3))).toBe('showing');
    expect(announcementStatus(window, at(4))).toBe('ended');
    expect(announcementStatus({ ...window, withdrawnAt: at(2) }, at(3))).toBe('withdrawn');
  });

  it('ends after it starts, within a month', () => {
    expect(announcementWindowIssue(at(2), at(2))?.issue).toBe('End after it starts');
    expect(announcementWindowIssue(at(1), new Date('2026-12-03T00:00:00Z'))?.path).toBe('endsAt');
    expect(announcementWindowIssue(at(1), at(30))).toBeNull();
  });
});
