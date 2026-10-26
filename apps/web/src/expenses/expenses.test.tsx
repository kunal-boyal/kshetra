import { todayIn } from '@thelamp/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const PERIOD = todayIn('Asia/Kolkata').slice(0, 7);
const claim = (id: string, patch: object) => ({
  id,
  userId: '01a10000-0000-7000-8000-000000000004',
  user: { id: '01a10000-0000-7000-8000-000000000004', code: 'SUN-004', name: 'Rahul Verma' },
  policy: 'meals',
  policyVersion: 1,
  expenseDate: `${PERIOD}-05`,
  description: 'Team lunch',
  quantity: null,
  rate: null,
  odometerOpen: null,
  odometerClose: null,
  shiftId: null,
  billAmount: '412.50',
  calculated: '412.50',
  amount: '412.50',
  capped: false,
  receipts: ['01a10000-0000-7000-8000-0000000000f1'],
  odometerPhotos: [],
  flags: [],
  state: 'approved',
  approval: null,
  paidAt: null,
  paymentReference: null,
  createdAt: `${PERIOD}-05T09:00:00.000Z`,
  decidedAt: `${PERIOD}-06T09:00:00.000Z`,
  ...patch,
});
const MEALS = '01a10000-0000-7000-8000-0000000000e1';
const DA = '01a10000-0000-7000-8000-0000000000e2';
const PAGES = {
  '/v1/expense-policies': {
    items: [
      {
        key: 'meals',
        name: { en: 'Meals', hi: 'भोजन' },
        category: 'other',
        calculation: 'actual',
        caps: {},
        receiptRequired: true,
        odometerPhotosRequired: false,
        active: true,
        version: 1,
        validFrom: '2000-01-01',
      },
      {
        key: 'da',
        name: { en: 'Daily allowance', hi: 'दैनिक भत्ता' },
        category: 'daily_allowance',
        calculation: 'per_day',
        rate: { flat: '500' },
        caps: { perClaim: '1200' },
        receiptRequired: false,
        odometerPhotosRequired: false,
        active: true,
        version: 1,
        validFrom: '2000-01-01',
      },
    ],
  },
  '/v1/expense-claims': {
    items: [
      claim(MEALS, { flags: ['duplicate_receipt'] }),
      claim(DA, {
        policy: 'da',
        description: 'Tour',
        quantity: '3.000',
        rate: '500.00',
        billAmount: null,
        calculated: '1500.00',
        amount: '1200.00',
        capped: true,
        receipts: [],
        flags: ['capped'],
        state: 'pending',
      }),
    ],
    nextCursor: null,
  },
};

describe('expense claims (M12)', () => {
  it('shows each claim with its caps and flags, and marks an approved one paid after asking', async () => {
    const client = fakeClient(PAGES, {}, ['expense.mark_paid']);
    // Marking paid answers the claim, paid.
    client.request.mockImplementation(
      async (method: string, path: string, _schema: unknown, options = {}) => {
        if (method === 'GET') {
          const bare = path.split('?')[0]!;
          return (PAGES as Record<string, unknown>)[bare];
        }
        return claim(MEALS, { state: 'paid', ...(options as { body?: object }).body });
      },
    );
    renderAt('/expenses', client);
    const table = await screen.findByRole('table', { name: 'Expense claims' });
    const meals = within(table).getByRole('row', { name: /Team lunch/ });
    expect(meals).toHaveTextContent('Meals');
    expect(meals).toHaveTextContent('₹412.50');
    expect(meals).toHaveTextContent('Receipt seen before');
    expect(meals).toHaveTextContent('Approved');
    const da = within(table).getByRole('row', { name: /Tour/ });
    expect(da).toHaveTextContent('₹1,200.00');
    expect(da).toHaveTextContent('of ₹1,500.00 calculated');
    expect(within(da).queryByRole('button', { name: /Mark paid/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(within(meals).getByRole('button', { name: /Mark paid/ }));
    const ask = screen.getByRole('group', { name: 'Mark ₹412.50 to Rahul Verma paid?' });
    await user.type(within(ask).getByRole('textbox', { name: /Payment reference/ }), 'NEFT 4471');
    await user.click(within(ask).getByRole('button', { name: 'Mark paid' }));
    await screen.findByRole('table', { name: 'Expense claims' });
    expect(
      writesOf(client).map(([method, path, , options]) => [method, path, options?.body]),
    ).toEqual([['POST', `/v1/expense-claims/${MEALS}/paid`, { reference: 'NEFT 4471' }]]);
  });

  it('asks the API for the month and status chosen', async () => {
    const client = fakeClient(PAGES, {}, ['approval.act']);
    renderAt('/expenses', client);
    await screen.findByRole('table', { name: 'Expense claims' });
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'pending');
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      `/v1/expense-claims?period=${PERIOD}&state=pending`,
      expect.anything(),
    );
  });
});
