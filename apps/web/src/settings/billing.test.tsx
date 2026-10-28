import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, renderAt } from '../test-support';

const INVOICE = {
  id: '01a10000-0000-7000-8000-0000000000e1',
  number: 'TL/26-27/00042',
  tenant: { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise', slug: 'sunrise' },
  kind: 'monthly',
  period: { from: '2026-10-01', to: '2026-10-31' },
  issuedOn: '2026-11-04',
  dueOn: '2026-11-19',
  seller: {
    legalName: 'Example Field Software Private Limited',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Pune',
    stateCode: '27',
    stateName: 'Maharashtra',
    email: 'billing@vendor.example',
    sac: '998314',
  },
  buyer: {
    legalName: 'Sunrise Agro Private Limited',
    gstin: null,
    address: 'Nashik',
    stateCode: '27',
    stateName: 'Maharashtra',
  },
  lines: [],
  subtotal: '5730.47',
  gstRate: '18',
  cgst: '515.74',
  sgst: '515.74',
  igst: '0.00',
  total: '6761.95',
  paid: '0.00',
  status: 'issued',
  example: false,
  payments: [],
};

const ACCOUNT = {
  legalName: 'Sunrise Agro Private Limited',
  gstin: null,
  address: 'Plot 9, MIDC, Nashik 422010',
  stateCode: '27',
  email: 'accounts@sunrise.example',
  language: 'en',
  mandate: 'none',
};

const BILLING = {
  account: ACCOUNT,
  subscription: {
    id: '01a10000-0000-7000-8000-0000000000d1',
    plan: {
      id: '01a10000-0000-7000-8000-0000000000c1',
      key: 'growth',
      name: { en: 'Growth', hi: 'ग्रोथ' },
    },
    cycle: 'month',
    committedSeats: null,
    status: 'active',
    startedOn: '2026-10-01',
    term: null,
    endsOn: null,
  },
  outstanding: '6761.95',
  dunning: {
    overdueSince: '2026-11-20',
    stage: 'grace',
    readOnlyOn: '2026-11-27',
    suspendOn: '2026-12-11',
    outstanding: '6761.95',
  },
  plan: { name: { en: 'Growth', hi: 'ग्रोथ' }, priceMonth: '499.00', priceYear: '4990.00' },
  modules: ['core', 'orders'],
  people: { active: 12, limit: 25 },
  trialEndsAt: null,
  automaticPayment: true,
  usage: [
    {
      period: '2026-10',
      metrics: { seats: '11.4839', sms: '42.0000' },
      updatedAt: '2026-10-31T18:00:00.000Z',
    },
  ],
};

const pages = (billing: object = BILLING) => ({
  '/v1/billing': () => billing,
  '/v1/billing/invoices': { items: [INVOICE], nextCursor: null },
});

describe('billing for tenant admins (spec M23, D90)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the plan, people, standing, subscription, usage and invoices, and downloads a PDF', async () => {
    const client = fakeClient(pages(), {}, ['billing.manage']);
    renderAt('/settings/billing', client);
    expect(
      await screen.findByText(/₹6,761.95 has been overdue since 20 Nov 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText('₹499.00 a month or ₹4,990.00 a year')).toBeInTheDocument();
    expect(screen.getByText('12 of 25')).toBeInTheDocument();
    expect(screen.getByText('Monthly, for the seats used in each month')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Usage' })).toHaveTextContent('11.48');
    const invoices = await screen.findByRole('table', { name: 'Invoices' });
    expect(within(invoices).getByRole('row', { name: /00042/ })).toHaveTextContent('₹6,761.95');
    // Billing alone of its group: the group is marked, with no row of pages under it.
    expect(screen.getByRole('link', { name: 'Organisation' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const plan = screen.getByRole('region', { name: 'Plan' });
    expect(within(plan).getByText('Growth')).toBeVisible();
    expect(within(plan).getByText('Monthly')).toBeVisible();
    expect(within(plan).getByRole('list', { name: 'Modules' })).toHaveTextContent('Orders');
    expect(screen.getByText('13 left')).toBeInTheDocument();
    expect(within(invoices).getByText('Due 19 Nov')).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download invoice TL/26-27/00042' }));
    await waitFor(() =>
      expect(client.file).toHaveBeenCalledWith(`/v1/billing/invoices/${INVOICE.id}/pdf`),
    );
  });

  it('changes the billing details, and sets up automatic payment', async () => {
    let billing: object = BILLING;
    const client = fakeClient(
      pages(BILLING),
      {
        'PUT /v1/billing/account': ({ body }) => {
          billing = { ...BILLING, account: { ...ACCOUNT, ...(body as object) } };
          return billing;
        },
        'POST /v1/billing/mandate': () => ({ url: 'https://pay.example/authorise/abc' }),
      },
      ['billing.manage'],
    );
    renderAt('/settings/billing', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change the billing details' }));
    const gstin = screen.getByLabelText(/^GSTIN/);
    await user.type(gstin, '27zzzzz0000z1zq');
    expect(gstin).toHaveValue('27ZZZZZ0000Z1ZQ');
    await user.click(screen.getByRole('button', { name: 'Save the billing details' }));
    // In the details and beside how the organisation pays.
    expect(await screen.findAllByText('27ZZZZZ0000Z1ZQ')).toHaveLength(2);
    expect(client.request).toHaveBeenCalledWith(
      'PUT',
      '/v1/billing/account',
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({ gstin: '27ZZZZZ0000Z1ZQ', stateCode: '27' }),
        idempotencyKey: expect.any(String),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Set up automatic payment' }));
    expect(
      await screen.findByRole('link', { name: 'Authorise automatic payment' }),
    ).toHaveAttribute('href', 'https://pay.example/authorise/abc');
  });

  it('says an invoice was paid, on the day of its last payment', async () => {
    const paid = {
      ...INVOICE,
      status: 'paid',
      paid: INVOICE.total,
      payments: [
        {
          id: '01a10000-0000-7000-8000-0000000000f1',
          amount: '6761.95',
          method: 'upi',
          reference: null,
          receivedOn: '2026-11-03',
          recordedAt: '2026-11-03T10:00:00.000Z',
        },
      ],
    };
    renderAt(
      '/settings/billing',
      fakeClient({ ...pages(), '/v1/billing/invoices': { items: [paid], nextCursor: null } }, {}, [
        'billing.manage',
      ]),
    );
    const invoices = await screen.findByRole('table', { name: 'Invoices' });
    expect(within(invoices).getByText('Paid 3 Nov')).toBeVisible();
  });

  it('says when there is no subscription or automatic payment yet', async () => {
    renderAt(
      '/settings/billing',
      fakeClient(
        pages({
          ...BILLING,
          subscription: null,
          dunning: null,
          automaticPayment: false,
          people: { active: 3, limit: null },
          usage: [],
        }),
        {},
        ['billing.manage'],
      ),
    );
    expect(await screen.findByText(/No subscription yet/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic payment arrives soon/)).toBeInTheDocument();
    expect(screen.getByText('3, with no limit')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set up automatic payment' }),
    ).not.toBeInTheDocument();
  });

  it('is not offered to people without billing.manage', async () => {
    renderAt('/settings/designations', fakeClient({ '/v1/designations': { items: [] } }, {}, []));
    expect(await screen.findByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
  });
});
