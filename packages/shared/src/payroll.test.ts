import { describe, expect, it } from 'vitest';
import { dayCounts, grossOn, type PayDay, provisionalPay } from './payroll';

const day = (status: PayDay['status'], value = 0, working = true): PayDay => ({
  status,
  value,
  working,
});

describe('BR-26: provisional pay (decision D117)', () => {
  it('FX-17: gross 30,000 with 3.5 paid days of 5 scheduled is 21,000.00', () => {
    const days = [
      day('present', 1),
      day('present', 1),
      day('present', 1),
      day('half_day', 0.5),
      day('absent'),
      day('weekly_off', 0, false),
    ];
    expect(provisionalPay('30000', days)).toEqual({
      scheduled: 5,
      paid: 3.5,
      amount: '21000.00',
    });
  });

  it('FX-18: no scheduled days in the period is 0.00', () => {
    expect(provisionalPay('30000', [day('holiday', 0, false)]).amount).toBe('0.00');
  });

  it('pays a joiner a part: days before joining are scheduled but unpaid', () => {
    const days = [
      ...Array.from({ length: 20 }, () => day('not_employed')),
      ...Array.from({ length: 10 }, () => day('present', 1)),
    ];
    expect(provisionalPay('30000', days)).toMatchObject({
      scheduled: 30,
      paid: 10,
      amount: '10000.00',
    });
  });

  it('counts the current month as earned so far, over the whole month', () => {
    const days = [
      ...Array.from({ length: 12 }, () => day('present', 1)),
      ...Array.from({ length: 13 }, () => day('future')),
      day('future', 0, false),
    ];
    expect(provisionalPay('26000', days)).toEqual({
      scheduled: 25,
      paid: 12,
      amount: '12480.00',
    });
  });

  it('never pays more than the gross, and rounds half up to the paisa', () => {
    // Worked on a weekly off: paid, not scheduled, so capped at the scheduled days.
    expect(provisionalPay('1000', [day('present', 1), day('present', 1, false)]).amount).toBe(
      '1000.00',
    );
    expect(provisionalPay('100', [day('present', 1), day('absent'), day('absent')]).amount).toBe(
      '33.33',
    );
    expect(provisionalPay('0.05', [day('present', 1), day('absent')]).amount).toBe('0.03');
  });
});

describe('the gross in force (decision D117)', () => {
  const changes = [
    { from: '2026-04', monthlyGross: '25000' },
    { from: '2026-10', monthlyGross: '28000' },
  ];

  it('takes the latest change from the month or before', () => {
    expect(grossOn(changes, '2026-03')).toBeNull();
    expect(grossOn(changes, '2026-04')).toBe('25000');
    expect(grossOn(changes, '2026-09')).toBe('25000');
    expect(grossOn(changes, '2026-11')).toBe('28000');
  });
});

describe('day counts', () => {
  it('counts each status', () => {
    expect(dayCounts([day('present', 1), day('present', 1), day('holiday')])).toMatchObject({
      present: 2,
      holiday: 1,
      absent: 0,
    });
  });
});
