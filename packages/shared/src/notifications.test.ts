import { describe, expect, it } from 'vitest';
import {
  inQuietHours,
  minutesUntilQuietEnds,
  mutable,
  NOTIFICATION_KINDS,
  smsSegments,
} from './notifications';

describe('quiet hours (M16)', () => {
  it('run past midnight', () => {
    expect(inQuietHours('22:30', '21:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '21:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '21:00', '07:00')).toBe(false);
    expect(inQuietHours('12:00', '21:00', '07:00')).toBe(false);
    expect(minutesUntilQuietEnds('22:30', '21:00', '07:00')).toBe(510);
    expect(minutesUntilQuietEnds('12:00', '21:00', '07:00')).toBe(0);
  });

  it('can sit inside a day, or be switched off by equal times', () => {
    expect(inQuietHours('14:00', '13:00', '15:00')).toBe(true);
    expect(inQuietHours('15:00', '13:00', '15:00')).toBe(false);
    expect(inQuietHours('03:00', '00:00', '00:00')).toBe(false);
  });
});

describe('what people may mute (M16)', () => {
  it('never approvals or tracking', () => {
    expect(mutable('approvals')).toBe(false);
    expect(mutable('tracking')).toBe(false);
    expect(mutable('plan')).toBe(true);
    expect(NOTIFICATION_KINDS['tracking.stopped'].urgent).toBe(true);
  });
});

describe('SMS segments', () => {
  it('count Hindi as Unicode', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('आज की योजना')).toBe(1);
    expect(smsSegments('आ'.repeat(71))).toBe(2);
  });
});
