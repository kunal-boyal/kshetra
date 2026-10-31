import { describe, expect, it } from 'vitest';
import { delegationActiveOn, delegationIssues, delegationsOverlap } from './delegation';

const base: Parameters<typeof delegationIssues>[0] = {
  delegatorId: 'a',
  delegateId: 'b',
  startsOn: '2026-11-02',
  endsOn: '2026-11-06',
  today: '2026-10-31',
  delegate: { active: true, mayApprove: true },
  others: [],
};
const paths = (overrides: Partial<typeof base>) =>
  delegationIssues({ ...base, ...overrides }).map((issue) => issue.path);

describe('approval delegation (D113)', () => {
  it('takes a delegate who may approve, for days to come within 90', () => {
    expect(delegationIssues(base)).toEqual([]);
    expect(paths({ startsOn: '2026-10-31', endsOn: '2027-01-28' })).toEqual([]);
  });

  it('refuses oneself, someone gone and someone who may not approve', () => {
    expect(paths({ delegateId: 'a' })).toEqual(['delegateId']);
    expect(paths({ delegate: null })).toEqual(['delegateId']);
    expect(paths({ delegate: { active: false, mayApprove: true } })).toEqual(['delegateId']);
    expect(paths({ delegate: { active: true, mayApprove: false } })).toEqual(['delegateId']);
  });

  it('refuses days gone, backwards and longer than 90', () => {
    expect(paths({ startsOn: '2026-10-30' })).toEqual(['startsOn']);
    expect(paths({ endsOn: '2026-11-01' })).toEqual(['endsOn']);
    expect(paths({ startsOn: '2026-11-01', endsOn: '2027-01-30' })).toEqual(['endsOn']);
  });

  it('refuses days another delegation covers, unless that one was ended', () => {
    const other = { startsOn: '2026-11-06', endsOn: '2026-11-10', endedAt: null };
    expect(paths({ others: [other] })).toEqual(['startsOn']);
    expect(paths({ others: [{ ...other, endedAt: '2026-11-01T10:00:00Z' }] })).toEqual([]);
    expect(
      delegationsOverlap(other, { ...other, startsOn: '2026-11-11', endsOn: '2026-11-12' }),
    ).toBe(false);
  });

  it('stands only on its days, and not once ended', () => {
    const days = { startsOn: '2026-11-02', endsOn: '2026-11-06', endedAt: null };
    expect(
      ['2026-11-01', '2026-11-02', '2026-11-06', '2026-11-07'].map((day) =>
        delegationActiveOn(days, day),
      ),
    ).toEqual([false, true, true, false]);
    expect(delegationActiveOn({ ...days, endedAt: '2026-11-03T05:00:00Z' }, '2026-11-04')).toBe(
      false,
    );
  });
});
