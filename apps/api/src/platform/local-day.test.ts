import { describe, expect, it } from 'vitest';
import { localMonth, startOfLocalDate } from './local-day';

describe('days and months on the tenant clock', () => {
  it('starts a day at local midnight', () => {
    expect(startOfLocalDate('2026-10-21', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-20T18:30:00.000Z',
    );
    expect(startOfLocalDate('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfLocalDate('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('bounds a month, across the year end', () => {
    expect(localMonth('2026-12', 'Asia/Kolkata')).toEqual({
      from: new Date('2026-11-30T18:30:00.000Z'),
      to: new Date('2026-12-31T18:30:00.000Z'),
    });
  });
});
