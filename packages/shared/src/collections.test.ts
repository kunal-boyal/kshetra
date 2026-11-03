import { describe, expect, it } from 'vitest';
import {
  collectedNotInBooks,
  collectionIssues,
  collectionMoveIssue,
  collectionNumber,
  collectionPreview,
  matchReceipts,
} from './collections';

const base = {
  amount: '12000',
  collectedOn: '2026-11-02',
  today: '2026-11-02',
  photos: 0,
  cashThatDay: '0',
  cashLimit: '200000.00',
};

describe('what a collection needs (FX-95, BR-63)', () => {
  it('asks each mode for its own references', () => {
    expect(collectionIssues({ ...base, mode: 'cash' })).toEqual([]);
    expect(collectionIssues({ ...base, mode: 'upi' })).toEqual([
      { path: 'reference', issue: 'reference_needed' },
    ]);
    expect(collectionIssues({ ...base, mode: 'bank_transfer', reference: 'NEFT 4471' })).toEqual(
      [],
    );
    expect(collectionIssues({ ...base, mode: 'cheque', chequeNumber: ' ' })).toEqual([
      { path: 'chequeNumber', issue: 'cheque_number_needed' },
      { path: 'chequeBank', issue: 'cheque_bank_needed' },
      { path: 'chequeDate', issue: 'cheque_date_needed' },
      { path: 'photos', issue: 'cheque_photo_needed' },
    ]);
    expect(
      collectionIssues({
        ...base,
        mode: 'cheque',
        chequeNumber: '004512',
        chequeBank: 'Bank of Maharashtra',
        chequeDate: '2026-11-05',
        photos: 1,
      }),
    ).toEqual([]);
  });

  it('refuses nothing collected, a later day, and cash from an account reaching ₹2 lakh in a day', () => {
    expect(collectionIssues({ ...base, mode: 'cash', amount: '0' })).toEqual([
      { path: 'amount', issue: 'amount' },
    ]);
    expect(collectionIssues({ ...base, mode: 'cash', collectedOn: '2026-11-03' })).toEqual([
      { path: 'collectedOn', issue: 'future' },
    ]);
    expect(collectionIssues({ ...base, mode: 'cash', amount: '199999.99' })).toEqual([]);
    expect(collectionIssues({ ...base, mode: 'cash', amount: '200000' })).toEqual([
      { path: 'amount', issue: 'over_cash_limit' },
    ]);
    // Split across two collections the same day, the second reaches the limit.
    expect(
      collectionIssues({ ...base, mode: 'cash', amount: '50000', cashThatDay: '150000' }),
    ).toEqual([{ path: 'amount', issue: 'over_cash_limit' }]);
    // Cheques don't count towards it, and a tenant may turn it off.
    expect(collectionIssues({ ...base, mode: 'upi', reference: 'U1', amount: '250000' })).toEqual(
      [],
    );
    expect(collectionIssues({ ...base, mode: 'cash', amount: '250000', cashLimit: null })).toEqual(
      [],
    );
  });

  it('numbers collections as people read them', () => {
    expect(collectionNumber(123)).toBe('COL-000123');
  });
});

describe('a collection’s status (FX-96, BR-63)', () => {
  const move = (
    from: Parameters<typeof collectionMoveIssue>[0]['from'],
    to: Parameters<typeof collectionMoveIssue>[0]['to'],
    more: Partial<Parameters<typeof collectionMoveIssue>[0]> = {},
  ) => collectionMoveIssue({ from, to, mode: 'cash', own: false, ...more });

  it('goes from recorded to confirmed or rejected, and confirmed to bounced or into the books', () => {
    expect(move('recorded', 'confirmed')).toBeNull();
    expect(move('recorded', 'rejected', { reason: 'Not received' })).toBeNull();
    expect(move('confirmed', 'bounced', { mode: 'cheque', reason: 'Funds short' })).toBeNull();
    expect(move('confirmed', 'in_books')).toBeNull();
    expect(move('in_books', 'confirmed')).toBeNull();
    expect(move('rejected', 'confirmed')).toBe('not_now');
    expect(move('recorded', 'bounced', { mode: 'cheque', reason: 'x' })).toBe('not_now');
    expect(move('bounced', 'confirmed')).toBe('not_now');
  });

  it('needs a reason to reject or bounce, bounces only cheques, and never decides one’s own', () => {
    expect(move('recorded', 'rejected', { reason: ' ' })).toBe('reason_needed');
    expect(move('confirmed', 'bounced', { reason: 'x' })).toBe('not_cheque');
    expect(move('recorded', 'confirmed', { own: true })).toBe('own');
    expect(move('recorded', 'rejected', { own: true, reason: 'x' })).toBe('own');
    // Matching to the books isn't a decision about one's own money.
    expect(move('confirmed', 'in_books', { own: true })).toBeNull();
  });
});

describe('matching the books’ receipts (FX-97, BR-63)', () => {
  const collection = (id: string, amount: string, collectedOn: string, accountId = 'shop') => ({
    id,
    accountId,
    amount,
    collectedOn,
    recordedAt: `${collectedOn}T10:00:00Z`,
  });
  const receipt = (id: string, amount: string, date: string, accountId = 'shop') => ({
    id,
    accountId,
    amount,
    date,
  });

  it('takes the oldest collection of the same account and amount, within 30 days', () => {
    expect(
      matchReceipts(
        [
          collection('c2', '12000.00', '2026-10-20'),
          collection('c1', '12000', '2026-10-05'),
          collection('c3', '5000', '2026-10-21'),
          collection('other', '12000', '2026-10-05', 'farm'),
        ],
        [receipt('r1', '12000', '2026-10-25'), receipt('r2', '12000.00', '2026-10-26')],
      ),
    ).toEqual([
      { collectionId: 'c1', receiptId: 'r1' },
      { collectionId: 'c2', receiptId: 'r2' },
    ]);
  });

  it('leaves a receipt dated before the collection, or more than 30 days after, unmatched', () => {
    expect(
      matchReceipts(
        [collection('c1', '8000', '2026-10-10')],
        [receipt('early', '8000', '2026-10-09'), receipt('late', '8000', '2026-11-10')],
      ),
    ).toEqual([]);
    expect(
      matchReceipts([collection('c1', '8000', '2026-10-10')], [receipt('r', '8000', '2026-11-09')]),
    ).toEqual([{ collectionId: 'c1', receiptId: 'r' }]);
  });
});

describe('what an account owes after its collections (FX-98, BR-63)', () => {
  it('counts recorded and confirmed collections, and never goes below zero', () => {
    const collections = [
      { amount: '12000', status: 'recorded' as const },
      { amount: '5000.50', status: 'confirmed' as const },
      { amount: '9000', status: 'rejected' as const },
      { amount: '3000', status: 'bounced' as const },
      { amount: '7000', status: 'in_books' as const },
    ];
    expect(collectedNotInBooks('38400', collections)).toEqual({
      notInBooks: '17000.50',
      leftAfter: '21399.50',
    });
    expect(collectedNotInBooks('10000', collections)).toEqual({
      notInBooks: '17000.50',
      leftAfter: '0.00',
    });
  });
});

describe('what a collection would settle (FX-99, BR-63)', () => {
  const invoices = [
    {
      number: 'INV-2342',
      date: '2026-09-28',
      dueDate: '2026-10-28',
      amount: '26400',
      cancelled: false,
    },
    {
      number: 'INV-2291',
      date: '2026-08-19',
      dueDate: '2026-09-18',
      amount: '12000',
      cancelled: false,
    },
  ];

  it('settles the oldest open invoice first, after receipts and collections not yet in the books', () => {
    expect(collectionPreview({ invoices, receipts: [], pending: [], amount: '15000' })).toEqual({
      settles: [
        { invoice: 'INV-2291', amount: '12000.00' },
        { invoice: 'INV-2342', amount: '3000.00' },
      ],
      advance: '0.00',
    });
    expect(
      collectionPreview({
        invoices,
        receipts: [
          {
            number: 'R-1',
            date: '2026-10-01',
            amount: '2000',
            against: ['INV-2291'],
            cancelled: false,
          },
        ],
        pending: [{ amount: '10000', collectedOn: '2026-11-01' }],
        amount: '30000',
      }),
    ).toEqual({ settles: [{ invoice: 'INV-2342', amount: '26400.00' }], advance: '3600.00' });
  });
});
