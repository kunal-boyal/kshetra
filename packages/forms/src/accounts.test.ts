import { describe, expect, it } from 'vitest';
import { AccountType } from './account-types';
import { accountSegments, checkSlots, primaryAssignee } from './accounts';

const text = (en: string) => ({ en, hi: en });

const DISTRIBUTOR = AccountType.parse({
  key: 'distributor',
  name: { en: { one: 'Distributor', other: 'Distributors' }, hi: { one: 'वितरक', other: 'वितरक' } },
  icon: 'store',
  code: { mode: 'manual' },
  fields: [{ key: 'annual_revenue', type: 'currency', label: text('Annual revenue') }],
  location: {},
  slots: [
    { key: 'asm', name: text('ASM'), designations: ['asm'], required: true, priority: 1 },
    { key: 'tm_so', name: text('TM or SO'), designations: ['tm', 'so'], priority: 2 },
    { key: 'sme', name: text('SME'), designations: ['sme'], priority: 3 },
  ],
  segmentRules: [
    {
      segment: 'commercially_active',
      name: text('Commercially active'),
      when: { match: 'all', clauses: [{ field: 'annual_revenue', op: 'gt', value: '500000' }] },
    },
  ],
});

describe('accounts (spec 5.5)', () => {
  it('tags segments from field values, and untags when they no longer match', () => {
    expect(accountSegments(DISTRIBUTOR, { annual_revenue: '750000.00' })).toEqual([
      'commercially_active',
    ]);
    expect(accountSegments(DISTRIBUTOR, { annual_revenue: '250000.00' })).toEqual([]);
    expect(accountSegments(DISTRIBUTOR, {})).toEqual([]);
  });

  it('fills slots only with the designations they allow, one person each', () => {
    expect(
      checkSlots(
        DISTRIBUTOR,
        [
          { slot: 'asm', userId: 'u1', designation: 'asm' },
          { slot: 'tm_so', userId: 'u2', designation: 'so' },
        ],
        { complete: true },
      ),
    ).toEqual([]);
    expect(
      checkSlots(
        DISTRIBUTOR,
        [
          { slot: 'tm_so', userId: 'u2', designation: 'sme' },
          { slot: 'tm_so', userId: 'u3', designation: 'tm' },
          { slot: 'boss', userId: 'u4', designation: 'asm' },
        ],
        { complete: true },
      ),
    ).toEqual([
      { path: 'slots.tm_so', issue: "This person's designation can't fill this slot" },
      { path: 'slots.tm_so', issue: 'A slot holds one person' },
      { path: 'slots.boss', issue: 'This type of account has no such slot' },
      { path: 'slots.asm', issue: 'Choose someone for this slot' },
    ]);
  });

  it('leaves required slots to the approver of a proposal', () => {
    expect(checkSlots(DISTRIBUTOR, [], { complete: false })).toEqual([]);
  });

  it('takes the primary assignee from the highest-priority filled slot', () => {
    const sme = { slot: 'sme', userId: 'u3' };
    const so = { slot: 'tm_so', userId: 'u2' };
    expect(primaryAssignee(DISTRIBUTOR, [sme, so])).toBe(so);
    expect(primaryAssignee(DISTRIBUTOR, [sme])).toBe(sme);
    expect(primaryAssignee(DISTRIBUTOR, [])).toBeNull();
  });
});
