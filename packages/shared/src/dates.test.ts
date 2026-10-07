import { describe, expect, it } from 'vitest';
import { momentDue, timeIn, todayIn } from './dates';

describe('todayIn', () => {
  it("gives the date on the tenant's own calendar", () => {
    const lateEvening = new Date('2026-10-05T20:00:00Z');
    expect(todayIn('Asia/Kolkata', lateEvening)).toBe('2026-10-06');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-05');
    expect(todayIn('America/New_York', lateEvening)).toBe('2026-10-05');
  });
});

describe('local moments (spec 12.3)', () => {
  it("read the time of day on the tenant's clock", () => {
    const instant = new Date('2026-10-05T20:00:00Z');
    expect(timeIn('Asia/Kolkata', instant)).toBe('01:30');
    expect(timeIn('America/New_York', instant)).toBe('16:00');
    expect(timeIn('UTC', new Date('2026-10-05T00:05:00Z'))).toBe('00:05');
  });

  it('come due once the local time has passed, on that local date', () => {
    const before = new Date('2026-10-05T19:59:00Z');
    const after = new Date('2026-10-05T20:00:00Z');
    expect(momentDue('01:30', 'Asia/Kolkata', before)).toEqual({ due: false, date: '2026-10-06' });
    expect(momentDue('01:30', 'Asia/Kolkata', after)).toEqual({ due: true, date: '2026-10-06' });
    expect(momentDue('08:00', 'America/New_York', after)).toEqual({
      due: true,
      date: '2026-10-05',
    });
  });
});
