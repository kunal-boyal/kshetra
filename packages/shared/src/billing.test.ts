import { describe, expect, it } from 'vitest';
import { billableSeats, periodDays } from './billing';

describe('billable seats (BR-45)', () => {
  it('FX-35: counts A in full, B from day 16 at 15/30, and C in full though gone on day 10', () => {
    const { start, end } = { start: '2026-11-01', end: '2026-11-30' };
    const result = billableSeats(
      [
        { userId: 'a', from: '2026-01-10', to: null },
        { userId: 'b', from: '2026-11-16', to: null },
        { userId: 'c', from: '2026-03-01', to: '2026-11-10' },
      ],
      start,
      end,
    );
    expect(result.seats).toBe(3);
    expect(result.byUser).toEqual([
      { userId: 'a', share: '1.0000' },
      { userId: 'b', share: '0.5000' },
      { userId: 'c', share: '1.0000' },
    ]);
    expect(result.units).toBe('2.5000');
  });

  it('counts each person once, from their earliest day, and leaves out those outside the period', () => {
    const result = billableSeats(
      [
        { userId: 'a', from: '2026-11-20', to: '2026-11-22' },
        { userId: 'a', from: '2026-11-05', to: '2026-11-08' },
        { userId: 'gone', from: '2025-01-01', to: '2026-10-31' },
        { userId: 'later', from: '2026-12-01', to: null },
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(result.seats).toBe(1);
    // From the 5th: 26 of 30 days.
    expect(result.byUser).toEqual([{ userId: 'a', share: '0.8667' }]);
  });

  it('counts everyone in full on an annual plan', () => {
    const result = billableSeats(
      [{ userId: 'b', from: '2026-11-16', to: null }],
      '2026-11-01',
      '2026-11-30',
      false,
    );
    expect(result.units).toBe('1.0000');
  });

  it('knows a month’s first and last days', () => {
    expect(periodDays('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodDays('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});
