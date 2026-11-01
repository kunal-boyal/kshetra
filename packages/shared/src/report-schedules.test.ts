import { describe, expect, it } from 'vitest';
import {
  latestSendDate,
  nextSendDate,
  scheduledPeriod,
  type ScheduleTiming,
  sendDue,
} from './report-schedules';

const monday: ScheduleTiming = { frequency: 'weekly', weekday: 1, at: '08:00' };
const monthly: ScheduleTiming = { frequency: 'monthly', weekday: null, at: '07:30' };

describe('BR-52: scheduled reports', () => {
  it('FX-46: finds the latest and next send across a month end', () => {
    // 2026-11-02 is a Monday.
    expect(latestSendDate(monday, { date: '2026-11-02', time: '07:59' })).toBe('2026-10-26');
    expect(latestSendDate(monday, { date: '2026-11-02', time: '08:00' })).toBe('2026-11-02');
    expect(nextSendDate(monday, { date: '2026-11-02', time: '07:59' })).toBe('2026-11-02');
    expect(nextSendDate(monday, { date: '2026-11-02', time: '08:00' })).toBe('2026-11-09');
    expect(latestSendDate(monthly, { date: '2026-12-31', time: '23:59' })).toBe('2026-12-01');
    expect(nextSendDate(monthly, { date: '2026-12-31', time: '23:59' })).toBe('2027-01-01');
    expect(nextSendDate(monthly, { date: '2027-01-01', time: '07:00' })).toBe('2027-01-01');
  });

  it('FX-47: a weekly send on the 1st reports last month complete', () => {
    // 2027-02-01 is a Monday.
    expect(scheduledPeriod('weekly', '2027-02-01')).toBe('2027-01');
    expect(scheduledPeriod('weekly', '2027-02-08')).toBe('2027-02');
    expect(scheduledPeriod('monthly', '2027-02-01')).toBe('2027-01');
    expect(scheduledPeriod('monthly', '2027-01-01')).toBe('2026-12');
  });

  it('FX-48: owes one send for the latest moment since it started, whatever was missed', () => {
    const since = { date: '2026-10-01', time: '12:00' };
    // Down for three weeks: one send, for the latest Monday.
    expect(sendDue(monday, since, { date: '2026-10-28', time: '10:00' })).toBe('2026-10-26');
    // Started on a Monday after its time: nothing until the next Monday.
    const late = { date: '2026-11-02', time: '09:00' };
    expect(sendDue(monday, late, { date: '2026-11-02', time: '09:15' })).toBeNull();
    expect(sendDue(monday, late, { date: '2026-11-09', time: '08:00' })).toBe('2026-11-09');
    // Started on a Monday before its time: that morning's send.
    const early = { date: '2026-11-02', time: '07:00' };
    expect(sendDue(monday, early, { date: '2026-11-02', time: '08:15' })).toBe('2026-11-02');
    // Before its time on the day, the last week's moment came before it started.
    expect(sendDue(monday, early, { date: '2026-11-02', time: '07:45' })).toBeNull();
  });

  it('keeps to the local clock, so a weekday in a zone with daylight saving stays put', () => {
    // 2026-03-29 is the Sunday Europe's clocks go forward; the dates are the tenant's own.
    const sunday: ScheduleTiming = { frequency: 'weekly', weekday: 7, at: '01:30' };
    expect(latestSendDate(sunday, { date: '2026-03-29', time: '03:00' })).toBe('2026-03-29');
    expect(nextSendDate(sunday, { date: '2026-03-29', time: '03:00' })).toBe('2026-04-05');
  });
});
