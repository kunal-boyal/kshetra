import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, printedText, renderAt, writesOf } from '../test-support';

const SHOP = '01a10000-0000-7000-8000-000000000080';
const SME = '01a10000-0000-7000-8000-000000000004';
const CASH = '01a10000-0000-7000-8000-0000000000d1';
const UPI = '01a10000-0000-7000-8000-0000000000d2';
const CHEQUE = '01a10000-0000-7000-8000-0000000000d3';
const PHOTO = '01a10000-0000-7000-8000-0000000000d9';
const RECEIPT = '01a10000-0000-7000-8000-0000000000e1';
const OFFICE = ['collection.view', 'collection.confirm'] as const;

function collection(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    number: 'COL-000001',
    account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
    collector: { id: SME, code: 'SME-04', name: 'Suresh Rao' },
    collectedOn: '2026-11-02',
    collectedAt: '2026-11-02T06:30:00.000Z',
    amount: '12000.00',
    mode: 'cash',
    reference: null,
    chequeNumber: null,
    chequeBank: null,
    chequeDate: null,
    note: null,
    photos: [],
    inGeofence: true,
    status: 'recorded',
    reason: null,
    decidedBy: null,
    decidedAt: null,
    receipt: null,
    can: { decide: true, bounce: false, match: false, unmatch: false },
    ...overrides,
  };
}

const LIST = {
  items: [
    collection(CASH),
    collection(UPI, {
      number: 'COL-000002',
      mode: 'upi',
      reference: 'UPI 4471',
      amount: '3000.00',
    }),
  ],
  nextCursor: null,
  summary: {
    counts: { recorded: 2, confirmed: 1, in_books: 1, bounced: 1 },
    amounts: {
      recorded: '15000.00',
      confirmed: '5000.00',
      in_books: '7000.00',
      bounced: '2500.00',
    },
  },
};

const decided = (ids: string[], refused: string[] = []) => ({
  results: ids.map((id) => ({
    id,
    collection: refused.includes(id) ? null : collection(id, { status: 'confirmed' }),
    error: refused.includes(id) ? { code: 'CONFLICT', message: 'Decided already.' } : null,
  })),
});

describe('collections (M11, BR-63, D132)', () => {
  it('shows the month’s collections waiting for the office, and confirms several at once', async () => {
    const client = fakeClient(
      { '/v1/collections': LIST, [`/v1/collections/${CASH}`]: collection(CASH) },
      { 'POST /v1/collections/decisions': () => decided([CASH, UPI], [UPI]) },
      [...OFFICE],
    );
    renderAt('/collections', client);
    // The office starts with what waits for it.
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(/^\/v1\/collections\?period=\d{4}-\d{2}&status=recorded$/),
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText('Waiting for the office', { selector: '.ks-kpi-label' }),
    ).toBeVisible();
    expect(screen.getByText('₹15,000.00')).toBeVisible();
    // Not yet in the books: waiting and confirmed.
    expect(screen.getByText('₹20,000.00')).toBeVisible();
    expect(screen.getByText('0 rejected, 1 bounced')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Collections of the month' });
    expect(within(table).getByText('UPI · UPI 4471')).toBeVisible();

    const user = userEvent.setup();
    const together = screen.getByRole('group', { name: 'Decide several at once' });
    await user.click(within(together).getByRole('checkbox', { name: 'Select all 2 waiting' }));
    await user.click(within(together).getByRole('button', { name: 'Confirm 2 selected' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          items: [
            { id: CASH, decision: 'confirm' },
            { id: UPI, decision: 'confirm' },
          ],
        },
      }),
    );
    expect(await within(together).findByRole('status')).toHaveTextContent(
      '1 decided. 1 could not be: it was decided already or is your own.',
    );
  });

  it('rejects one beside the list only with a reason', async () => {
    const client = fakeClient(
      { '/v1/collections': LIST, [`/v1/collections/${CASH}`]: collection(CASH) },
      { 'POST /v1/collections/decisions': () => decided([CASH]) },
      [...OFFICE],
    );
    renderAt('/collections', client);
    const preview = await screen.findByRole('complementary', { name: 'COL-000001' });
    expect(await within(preview).findByText('Suresh Rao (SME-04)')).toBeVisible();
    expect(within(preview).getByText('At the account')).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(preview).getByRole('button', { name: 'Reject' }));
    const asking = within(preview).getByRole('group', { name: 'Reject this collection?' });
    const reject = within(asking).getByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    await user.type(within(asking).getByLabelText('Why'), 'Not in the bank');
    await user.click(reject);
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: { items: [{ id: CASH, decision: 'reject', reason: 'Not in the bank' }] },
      }),
    );
  });

  it('marks a confirmed cheque bounced and matches it to a receipt by hand', async () => {
    const cheque = collection(CHEQUE, {
      number: 'COL-000003',
      mode: 'cheque',
      chequeNumber: '004512',
      chequeBank: 'Bank of Maharashtra',
      chequeDate: '2026-11-05',
      photos: [PHOTO],
      status: 'confirmed',
      can: { decide: false, bounce: true, match: true, unmatch: false },
    });
    const client = fakeClient(
      {
        '/v1/collections': { items: [cheque], nextCursor: null, summary: null },
        [`/v1/collections/${CHEQUE}`]: cheque,
        [`/v1/media/${PHOTO}/url`]: { url: 'https://media.example/cheque.jpg', expiresAt: '' },
        [`/v1/accounts/${SHOP}/receipts`]: {
          items: [
            {
              id: RECEIPT,
              number: 'R-1',
              date: '2026-11-03',
              amount: '12000.00',
              kind: 'receipt',
              against: [],
              cancelled: false,
            },
          ],
          nextCursor: null,
        },
      },
      {
        'POST /v1/collections/:id/bounce': () => ({ ...cheque, status: 'bounced' }),
        [`POST /v1/collections/${CHEQUE}/bounce`]: () => ({ ...cheque, status: 'bounced' }),
        [`POST /v1/collections/${CHEQUE}/match`]: () => ({ ...cheque, status: 'in_books' }),
      },
      [...OFFICE],
    );
    renderAt('/collections', client);
    const preview = await screen.findByRole('complementary', { name: 'COL-000003' });
    expect(await within(preview).findByText('Cheque 004512 · Bank of Maharashtra')).toBeVisible();
    expect(within(preview).getByRole('img', { name: 'Photo 1 of the cheque' })).toBeVisible();
    const user = userEvent.setup();

    await user.click(within(preview).getByRole('button', { name: 'Match to a receipt' }));
    await user.selectOptions(
      await within(preview).findByLabelText('The receipt in the books'),
      RECEIPT,
    );
    await user.click(within(preview).getByRole('button', { name: 'Match' }));
    await waitFor(() =>
      expect(writesOf(client)[0]).toMatchObject([
        'POST',
        `/v1/collections/${CHEQUE}/match`,
        expect.anything(),
        { body: { receiptId: RECEIPT } },
      ]),
    );

    await user.click(within(preview).getByRole('button', { name: 'Cheque bounced' }));
    const asking = within(preview).getByRole('group', { name: 'Mark this cheque bounced?' });
    await user.type(within(asking).getByLabelText('Why'), 'Funds insufficient');
    await user.click(within(asking).getByRole('button', { name: 'Mark bounced' }));
    await waitFor(() =>
      expect(writesOf(client)[1]).toMatchObject([
        'POST',
        `/v1/collections/${CHEQUE}/bounce`,
        expect.anything(),
        { body: { reason: 'Funds insufficient' } },
      ]),
    );
  });

  it('prints a receipt that says when the office hasn’t confirmed it yet', async () => {
    const client = fakeClient(
      {
        [`/v1/collections/${CASH}`]: collection(CASH, {
          can: { decide: false, bounce: false, match: false, unmatch: false },
        }),
      },
      {},
      ['collection.record'],
    );
    renderAt(`/collections/${CASH}`, client);
    expect(await screen.findByRole('heading', { name: 'COL-000001', level: 1 })).toBeVisible();
    // The collector can't decide their own: no office actions.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    const receipt = await printedText(() =>
      userEvent.setup().click(screen.getByRole('button', { name: 'Print the receipt' })),
    );
    expect(receipt).toContain('Received ₹12,000.00 from Beej Bhandar (D-81)');
    expect(receipt).toContain('Twelve thousand rupees');
    expect(receipt).toContain('Awaiting the office’s confirmation.');
  });

  it('prints no receipt for money turned down', async () => {
    const client = fakeClient(
      {
        [`/v1/collections/${CASH}`]: collection(CASH, {
          status: 'rejected',
          reason: 'Not in the bank',
          can: { decide: false, bounce: false, match: false, unmatch: false },
        }),
      },
      {},
      [...OFFICE],
    );
    renderAt(`/collections/${CASH}`, client);
    expect(await screen.findByText('Not in the bank')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Print the receipt' })).toBeNull();
  });
});
