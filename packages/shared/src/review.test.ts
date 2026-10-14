import { describe, expect, it } from 'vitest';
import { autoApprovable, integrityWarning, reviewRefusal } from './review';

const ME = 'reviewer';
const THEM = 'author';

describe('deciding a submission (M7)', () => {
  it('never lets anyone review their own work', () => {
    expect(
      reviewRefusal({
        reviewerId: ME,
        authorId: ME,
        current: 'pending',
        decision: 'approved',
        note: null,
      }),
    ).toBe('OWN_WORK');
  });

  it('approves without a note, but rejects only with one of 3 characters or more', () => {
    const base = { reviewerId: ME, authorId: THEM, current: 'pending' as const };
    expect(reviewRefusal({ ...base, decision: 'approved', note: null })).toBeNull();
    expect(reviewRefusal({ ...base, decision: 'rejected', note: ' no ' })).toBe('NOTE_REQUIRED');
    expect(reviewRefusal({ ...base, decision: 'rejected', note: 'Blurry photo' })).toBeNull();
  });

  it('changes a decision only with a note, and does nothing when it is the same', () => {
    const base = { reviewerId: ME, authorId: THEM };
    expect(reviewRefusal({ ...base, current: 'approved', decision: 'rejected', note: null })).toBe(
      'NOTE_REQUIRED',
    );
    expect(reviewRefusal({ ...base, current: 'rejected', decision: 'approved', note: null })).toBe(
      'NOTE_REQUIRED',
    );
    expect(
      reviewRefusal({ ...base, current: 'rejected', decision: 'approved', note: 'Rechecked' }),
    ).toBeNull();
    expect(reviewRefusal({ ...base, current: 'approved', decision: 'approved', note: null })).toBe(
      'UNCHANGED',
    );
  });
});

describe('auto-approval (M7, decision D51)', () => {
  it('approves only what has no flags, is not outside the geofence, and comes from a genuine device', () => {
    const clean = { flags: [], geofence: 'inside' as const, integrityVerdict: null };
    expect(autoApprovable(clean)).toBe(true);
    expect(autoApprovable({ ...clean, geofence: null })).toBe(true);
    expect(autoApprovable({ ...clean, geofence: 'unknown' })).toBe(true);
    expect(autoApprovable({ ...clean, geofence: 'outside' })).toBe(false);
    expect(autoApprovable({ ...clean, flags: ['clock_skew'] })).toBe(false);
    expect(autoApprovable({ ...clean, integrityVerdict: 'MEETS_BASIC_INTEGRITY' })).toBe(false);
    expect(autoApprovable({ ...clean, integrityVerdict: 'MEETS_DEVICE_INTEGRITY' })).toBe(true);
  });

  it('counts a device with no verdict yet as genuine', () => {
    expect(integrityWarning(null)).toBe(false);
    expect(integrityWarning('MEETS_STRONG_INTEGRITY')).toBe(false);
    expect(integrityWarning('UNEVALUATED')).toBe(true);
  });
});
