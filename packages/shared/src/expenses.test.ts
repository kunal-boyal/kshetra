import { describe, expect, it } from 'vitest';
import {
  capClaim,
  claimBase,
  claimIssues,
  distanceGap,
  expensePolicyIssues,
  type ExpensePolicyRule,
  odometerDistance,
  rateFor,
  receiptHoldsApproval,
  trackedKm,
} from './expenses';

const policy = (patch: Partial<ExpensePolicyRule> = {}): ExpensePolicyRule => ({
  calculation: 'per_km',
  rate: { flat: '8' },
  caps: {},
  receiptRequired: false,
  odometerPhotosRequired: false,
  active: true,
  ...patch,
});

describe('BR-29: what a claim comes to', () => {
  it('FX-21: per km, odometer 1,000 to 1,042 at 8 is 42 km and 336.00', () => {
    expect(odometerDistance('1000', '1042')).toBe('42.00');
    expect(
      claimBase({ calculation: 'per_km', rate: '8', odometerOpen: '1000', odometerClose: '1042' }),
    ).toEqual({ quantity: '42.00', amount: '336.00' });
  });

  it('FX-22: per day, 3 days at 500 with a per-claim cap of 1,200 is 1,200.00', () => {
    const base = claimBase({ calculation: 'per_day', rate: '500', days: '3' });
    expect(base).toEqual({ quantity: '3', amount: '1500.00' });
    expect(capClaim(base.amount, { perClaim: '1200' }, { day: '0', month: '0' })).toEqual({
      amount: '1200.00',
      capped: true,
    });
  });

  it('pays visits that day at the rate, and the bill as it is', () => {
    expect(claimBase({ calculation: 'per_visit', rate: '25.50', visits: 3 }).amount).toBe('76.50');
    expect(claimBase({ calculation: 'actual', rate: null, billAmount: '412.5' })).toEqual({
      quantity: null,
      amount: '412.50',
    });
    // Rounded half-up to paise.
    expect(
      claimBase({ calculation: 'per_km', rate: '3.33', odometerOpen: '0', odometerClose: '10.5' })
        .amount,
    ).toBe('34.97');
  });

  it('caps by what is left of the day and the month after other claims', () => {
    const caps = { perClaim: '1000', perDay: '1200', perMonth: '5000' };
    expect(capClaim('900', caps, { day: '500', month: '1000' })).toEqual({
      amount: '700.00',
      capped: true,
    });
    expect(capClaim('900', caps, { day: '0', month: '4800' })).toEqual({
      amount: '200.00',
      capped: true,
    });
    expect(capClaim('900', caps, { day: '1500', month: '0' })).toEqual({
      amount: '0.00',
      capped: true,
    });
    expect(capClaim('900', {}, { day: '0', month: '0' })).toEqual({
      amount: '900.00',
      capped: false,
    });
  });

  it('takes the rate of the person’s designation', () => {
    const byDesignation = { byDesignation: { tm: '350', asm: '500' } };
    expect(rateFor(byDesignation, 'asm')).toBe('500');
    expect(rateFor(byDesignation, 'sme')).toBeNull();
    expect(rateFor({ flat: '8' }, 'sme')).toBe('8');
  });
});

describe('BR-29: what refuses a claim', () => {
  const base = { rate: '8', expenseDate: '2026-10-20', today: '2026-10-24', odometerPhotos: 0 };

  it('accepts readings in order, and refuses them backwards or missing', () => {
    expect(
      claimIssues({
        ...base,
        policy: policy(),
        odometerOpen: '1000',
        odometerClose: '1042',
        amount: '336.00',
      }),
    ).toEqual([]);
    expect(
      claimIssues({
        ...base,
        policy: policy(),
        odometerOpen: '1042',
        odometerClose: '1000',
        amount: '0.00',
      }),
    ).toEqual([{ path: 'odometerClose', issue: 'closing_before_opening' }]);
    expect(claimIssues({ ...base, policy: policy(), amount: '0.00' })).toEqual([
      { path: 'odometerOpen', issue: 'readings_needed' },
    ]);
  });

  it('refuses a future day, missing photos, days, a bill, no rate and nothing left', () => {
    expect(
      claimIssues({
        ...base,
        expenseDate: '2026-10-25',
        policy: policy({ odometerPhotosRequired: true }),
        odometerOpen: '1',
        odometerClose: '2',
        odometerPhotos: 1,
        amount: '8.00',
      }).map((issue) => issue.issue),
    ).toEqual(['future', 'odometer_photos']);
    expect(
      claimIssues({ ...base, policy: policy({ calculation: 'per_day' }), amount: '0.00' })[0],
    ).toEqual({ path: 'days', issue: 'days_needed' });
    expect(
      claimIssues({
        ...base,
        rate: null,
        policy: policy({ calculation: 'actual', rate: undefined }),
        amount: '0.00',
      })[0],
    ).toEqual({ path: 'billAmount', issue: 'bill_needed' });
    expect(
      claimIssues({
        ...base,
        rate: null,
        policy: policy({ calculation: 'per_day' }),
        days: '1',
        amount: '0.00',
      })[0],
    ).toEqual({ path: 'policy', issue: 'no_rate' });
    expect(
      claimIssues({
        ...base,
        policy: policy({ calculation: 'per_day' }),
        days: '1',
        amount: '0.00',
      }),
    ).toEqual([{ path: 'policy', issue: 'nothing_left' }]);
  });
});

describe('BR-30 and policy settings', () => {
  it('holds up approval without a receipt where the policy needs one', () => {
    expect(receiptHoldsApproval({ receiptRequired: true }, 0)).toBe(true);
    expect(receiptHoldsApproval({ receiptRequired: true }, 1)).toBe(false);
    expect(receiptHoldsApproval({ receiptRequired: false }, 0)).toBe(false);
  });

  it('checks a policy’s rate, designations, caps and photos', () => {
    expect(
      expensePolicyIssues(
        policy({
          calculation: 'per_day',
          rate: { byDesignation: { nobody: '0' } },
          caps: { perDay: '0' },
          odometerPhotosRequired: true,
        }),
        new Set(['tm']),
        ['items', 0],
      ).map((issue) => issue.path),
    ).toEqual([
      'items[0].rate.byDesignation.nobody',
      'items[0].rate.byDesignation.nobody',
      'items[0].caps.perDay',
      'items[0].odometerPhotosRequired',
    ]);
  });
});

describe('decision D115: claims from tracked distance', () => {
  it('turns metres into kilometres to 2 places, half up', () => {
    expect(trackedKm(0)).toBe('0.00');
    expect(trackedKm(42_004)).toBe('42.00');
    expect(trackedKm(42_005)).toBe('42.01');
    expect(trackedKm(1_999)).toBe('2.00');
  });

  it('pays the tracked kilometres at the rate, whatever the readings say', () => {
    expect(
      claimBase({
        calculation: 'per_km',
        kmFrom: 'tracked',
        trackedKm: '37.50',
        rate: '8',
        odometerOpen: '1000',
        odometerClose: '1042',
      }),
    ).toEqual({ quantity: '37.50', amount: '300.00' });
  });

  it('keeps paying readings under an odometer policy, named or left out', () => {
    const readings = { odometerOpen: '1000', odometerClose: '1042', trackedKm: '30.00' };
    expect(claimBase({ calculation: 'per_km', rate: '8', ...readings }).quantity).toBe('42.00');
    expect(
      claimBase({ calculation: 'per_km', kmFrom: 'odometer', rate: '8', ...readings }).quantity,
    ).toBe('42.00');
  });

  it('needs no readings under a tracked policy, but a day with an ended shift', () => {
    const tracked = policy({ kmFrom: 'tracked' });
    const base = { policy: tracked, rate: '8', expenseDate: '2026-10-30', today: '2026-10-31' };
    expect(
      claimIssues({ ...base, odometerPhotos: 0, trackedKm: '12.00', amount: '96.00' }),
    ).toEqual([]);
    expect(claimIssues({ ...base, odometerPhotos: 0, trackedKm: null, amount: '0.00' })).toEqual([
      { path: 'expenseDate', issue: 'tracked_needed' },
    ]);
    expect(claimIssues({ ...base, odometerPhotos: 0, trackedKm: '0.00', amount: '0.00' })).toEqual([
      { path: 'expenseDate', issue: 'nothing_tracked' },
    ]);
  });

  it('still refuses readings that run backwards, and missing photos the policy asks for', () => {
    const tracked = policy({ kmFrom: 'tracked', odometerPhotosRequired: true });
    expect(
      claimIssues({
        policy: tracked,
        rate: '8',
        expenseDate: '2026-10-30',
        today: '2026-10-31',
        odometerOpen: '1042',
        odometerClose: '1000',
        odometerPhotos: 0,
        trackedKm: '12.00',
        amount: '96.00',
      }),
    ).toEqual([
      { path: 'odometerClose', issue: 'closing_before_opening' },
      { path: 'odometerPhotoIds', issue: 'odometer_photos' },
    ]);
  });

  it('flags a gap over 10% of the larger figure and at least 2 km', () => {
    expect(distanceGap('50.00', '44.00')).toBe(true);
    expect(distanceGap('50.00', '45.00')).toBe(false);
    expect(distanceGap('44.00', '50.00')).toBe(true);
    expect(distanceGap('10.00', '8.50')).toBe(false);
    expect(distanceGap('10.00', '8.00')).toBe(true);
    expect(distanceGap('42.00', '0.00')).toBe(true);
    expect(distanceGap('0.00', '0.00')).toBe(false);
  });

  it('takes where kilometres come from on per-km policies only', () => {
    expect(
      expensePolicyIssues(policy({ calculation: 'per_day', kmFrom: 'tracked' }), new Set(), [
        'items',
        0,
      ]),
    ).toEqual([
      {
        path: 'items[0].kmFrom',
        issue: 'Where kilometres come from applies to per-km claims only',
      },
    ]);
    expect(expensePolicyIssues(policy({ kmFrom: 'tracked' }), new Set(), ['items', 0])).toEqual([]);
  });
});
