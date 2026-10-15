import { describe, expect, it } from 'vitest';
import { targetValueIssue, unlockRefusal } from './targets';

describe('target and plan values (spec 5.8)', () => {
  it('takes whole counts, money to the paisa, and quantities to three decimals', () => {
    expect(targetValueIssue('count', '40')).toBeNull();
    expect(targetValueIssue('count', '40.5')).toBe('Enter a whole number');
    expect(targetValueIssue('currency', '125000.50')).toBeNull();
    expect(targetValueIssue('currency', '1.005')).toBe('Use at most 2 decimals');
    expect(targetValueIssue('quantity', '12.125')).toBeNull();
    expect(targetValueIssue('percent', '85.5')).toBeNull();
  });

  it('refuses what is not a number of zero or more, or too large', () => {
    expect(targetValueIssue('count', '-1')).toBe('Enter a number of zero or more');
    expect(targetValueIssue('currency', '1,000')).toBe('Enter a number of zero or more');
    expect(targetValueIssue('count', '')).toBe('Enter a number of zero or more');
    expect(targetValueIssue('currency', '1000000000000')).toBe('This number is too large');
  });
});

describe('unlocking a locked target set (BR-08)', () => {
  it('needs admin unlock switched on, the permission, and a reason of 10 characters', () => {
    const ok = { adminUnlock: true, holdsUnlock: true, reason: 'Territory changed mid-month' };
    expect(unlockRefusal(ok)).toBeNull();
    expect(unlockRefusal({ ...ok, adminUnlock: false })).toBe('NOT_ENABLED');
    expect(unlockRefusal({ ...ok, holdsUnlock: false })).toBe('FORBIDDEN');
    expect(unlockRefusal({ ...ok, reason: ' too short ' })).toBe('REASON_REQUIRED');
  });
});
