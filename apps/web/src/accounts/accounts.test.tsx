import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, printedText, renderAt, writesOf } from '../test-support';

const SHOP = '01a10000-0000-7000-8000-000000000080';
const DEPOT = '01a10000-0000-7000-8000-000000000081';
const MARKET = '01a10000-0000-7000-8000-000000000010';
const ASM = '01a10000-0000-7000-8000-000000000003';
const SME = '01a10000-0000-7000-8000-000000000004';
const text = (en: string) => ({ en, hi: en });

const DISTRIBUTOR = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'distributor',
  name: noun('Distributor', 'Distributors'),
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [
    { key: 'annual_revenue', type: 'currency', label: text('Annual revenue'), required: false },
  ],
  location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'field_users_with_approval',
  slots: [
    { key: 'sme', name: text('SME'), designations: ['sme'], required: false, priority: 1 },
    { key: 'asm', name: text('ASM'), designations: ['asm'], required: true, priority: 3 },
  ],
  segmentRules: [
    {
      segment: 'commercially_active',
      name: text('Commercially active'),
      when: { match: 'all', clauses: [{ field: 'annual_revenue', op: 'gt', value: '500000' }] },
    },
  ],
  visitFrequencyNorms: [],
  contacts: true,
};
const FARMER = {
  ...DISTRIBUTOR,
  id: '01a10000-0000-7000-8000-000000000071',
  key: 'farmer',
  name: noun('Farmer', 'Farmers'),
  fields: [],
  segmentRules: [],
  slots: [DISTRIBUTOR.slots[0]],
};

function account(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'distributor',
    code: `D-${id.slice(-2)}`,
    name,
    territory: { id: MARKET, code: 'N-DEL', name: 'Delhi Market' },
    parent: null,
    outstanding: null,
    address: { city: 'Delhi' },
    location: null,
    geofenceRadiusM: null,
    locationStatus: 'unverified',
    status: 'active',
    segments: ['commercially_active'],
    custom: { annual_revenue: '750000.00' },
    slots: [
      {
        slot: 'asm',
        user: { id: ASM, code: 'SUN-003', name: 'Arjun Singh' },
        validFrom: '2026-10-01',
      },
      {
        slot: 'sme',
        user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        validFrom: '2026-10-01',
      },
    ],
    primarySlot: 'sme',
    missingSlots: [],
    createdAt: '2026-10-01T07:00:00.000Z',
    updatedAt: '2026-10-01T07:00:00.000Z',
    ...overrides,
  };
}

const SHOP_ACCOUNT = account(SHOP, 'Green Fields Agro');
const OVERVIEW = {
  account: SHOP_ACCOUNT,
  contacts: [
    {
      id: '01a10000-0000-7000-8000-000000000085',
      accountId: SHOP,
      name: 'Meena Shah',
      role: 'Owner',
      phone: '+919876543210',
      email: null,
      active: true,
    },
  ],
  assignments: [
    {
      slot: 'sme',
      user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
      validFrom: '2026-10-01',
      validTo: null,
    },
    {
      slot: 'asm',
      user: { id: ASM, code: 'SUN-003', name: 'Arjun Singh' },
      validFrom: '2026-10-01',
      validTo: null,
    },
  ],
  locationProposals: [],
  approvalId: null,
};

const MANAGE = ['account.view', 'account.manage', 'user.view'] as const;
const BUNDLE = { accountTypes: [DISTRIBUTOR, FARMER] };

describe('the accounts table', () => {
  it('lists a type with its own fields, segments and who looks after each', async () => {
    const client = fakeClient(
      {
        '/v1/accounts': {
          items: [
            SHOP_ACCOUNT,
            account(DEPOT, 'Beej Bhandar', {
              segments: [],
              status: 'pending',
              missingSlots: ['asm'],
              outstanding: '12500.00',
            }),
          ],
          nextCursor: null,
          summary: { types: { distributor: 2, farmer: 40 }, pending: 1 },
        },
      },
      {},
      MANAGE,
      BUNDLE,
    );
    renderAt('/accounts', client);
    const table = await screen.findByRole('table', { name: 'Distributors you see' });
    const shop = within(table).getByRole('row', { name: /Green Fields Agro/ });
    expect(shop).toHaveTextContent('Delhi Market');
    expect(shop).toHaveTextContent('Suresh Rao');
    // The type's own fields and segments stay on the account's page, as the prototype has it.
    expect(within(table).queryByRole('columnheader', { name: 'Annual revenue' })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Outstanding' })).toBeVisible();
    const depot = within(table).getByRole('row', { name: /Beej Bhandar/ });
    expect(depot).toHaveTextContent('Waiting for approval');
    expect(depot).toHaveTextContent('Needs ASM');
    expect(depot).toHaveTextContent('₹12,500.00');
    expect(shop).toHaveTextContent('—');
    // What waits for approval, a tap from being shown (decision D104).
    const banner = screen.getByText(
      '1 new Distributor was added from phones and waits for approval.',
    );
    expect(banner.closest('.ks-banner')).toHaveClass('info');
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/v1/accounts?type=distributor&limit=50',
      expect.anything(),
    );

    const user = userEvent.setup();
    const tabs = screen.getByRole('tablist', { name: 'Type' });
    expect(within(tabs).getByRole('tab', { name: 'Distributors · 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(tabs).getByRole('tab', { name: 'Farmers · 40' }));
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        '/v1/accounts?type=farmer&limit=50',
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('table', { name: 'Farmers you see' })).toBeVisible();
  });
  it('shows the type’s located accounts on a map when asked', async () => {
    const pin = (id: string, name: string, type: string, visited: boolean) => ({
      id,
      code: `C-${id.slice(-2)}`,
      name,
      type,
      location: { lat: 28.6315, lng: 77.2167 },
      visited,
    });
    const client = fakeClient(
      {
        '/v1/accounts': { items: [SHOP_ACCOUNT], nextCursor: null },
        '/v1/account-pins': {
          period: '2026-10',
          items: [
            pin(SHOP, 'Green Fields Agro', 'distributor', true),
            pin(DEPOT, 'Beej Bhandar', 'distributor', false),
            pin('01a10000-0000-7000-8000-0000000000f1', 'Ram Lal', 'farmer', false),
          ],
          truncated: false,
        },
      },
      {},
      MANAGE,
      BUNDLE,
    );
    renderAt('/accounts', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Show on a map' }));
    expect(await screen.findByRole('img', { name: 'Distributors on a map' })).toBeVisible();
    expect(
      screen.getByText('2 with a known place; filled ones were visited this month.'),
    ).toBeVisible();
  });
});

describe("an account's finance (M11, D79)", () => {
  const snapshot = (patch: object) => ({
    [`/v1/accounts/${SHOP}/overview`]: OVERVIEW,
    [`/v1/accounts/${SHOP}/finance`]: {
      latest: {
        id: '01a10000-0000-7000-8000-0000000000a9',
        accountId: SHOP,
        asOf: '2026-10-15',
        outstanding: '42000.50',
        creditLimit: '75000.00',
        inventoryValue: null,
        ageing: {},
        source: 'Tally',
        createdAt: '2026-10-15T05:00:00.000Z',
        ...patch,
      },
      history: [],
    },
  });

  it('shows no meter without a credit limit, and the danger tone past one', async () => {
    renderAt(
      `/accounts/${SHOP}`,
      fakeClient(snapshot({ creditLimit: null }), {}, ['account.view', 'finance.view'], BUNDLE),
    );
    const finance = await screen.findByRole('region', { name: 'Finance' });
    await waitFor(() => expect(finance).toHaveTextContent('No limit set'));
    expect(finance.querySelector('.ks-bar')).toBeNull();
    // Nothing aged, so no bar.
    expect(within(finance).queryByRole('img', { name: 'Ageing' })).toBeNull();
  });

  it('marks a limit run past', async () => {
    renderAt(
      `/accounts/${SHOP}`,
      fakeClient(
        snapshot({ creditLimit: '40000.00' }),
        {},
        ['account.view', 'finance.view'],
        BUNDLE,
      ),
    );
    const finance = await screen.findByRole('region', { name: 'Finance' });
    await waitFor(() => expect(finance).toHaveTextContent('105% of the limit used'));
    expect(finance.querySelector('.ks-stat.danger')).not.toBeNull();
  });

  it('shows the latest balance with its ageing, and the statement with running balances', async () => {
    const year = new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0);
    const client = fakeClient(
      {
        [`/v1/accounts/${SHOP}/overview`]: OVERVIEW,
        [`/v1/accounts/${SHOP}/finance`]: {
          latest: {
            id: '01a10000-0000-7000-8000-0000000000a9',
            accountId: SHOP,
            asOf: '2026-10-15',
            outstanding: '42000.50',
            creditLimit: '75000.00',
            inventoryValue: null,
            ageing: { d0_30: '32000.50', d181: '10000.00' },
            source: 'Tally',
            createdAt: '2026-10-15T05:00:00.000Z',
          },
          history: [],
        },
        [`/v1/accounts/${SHOP}/statement`]: {
          from: `${year}-04-01`,
          to: `${year + 1}-03-31`,
          opening: '1000.00',
          closing: '8000.00',
          entries: [
            {
              id: '01a10000-0000-7000-8000-0000000000b9',
              date: `${year}-04-10`,
              reference: 'INV-1',
              description: 'Invoice 1',
              debit: '10000.00',
              credit: '0.00',
              balance: '11000.00',
            },
            {
              id: '01a10000-0000-7000-8000-0000000000ba',
              date: `${year}-05-02`,
              reference: 'RCPT-1',
              description: null,
              debit: '0.00',
              credit: '3000.00',
              balance: '8000.00',
            },
          ],
          truncated: false,
          count: 2,
        },
      },
      { 'POST /v1/ledger-entries': () => ({ created: 1, unchanged: 0 }) },
      ['account.view', 'finance.view', 'finance.manage'],
      BUNDLE,
    );
    renderAt(`/accounts/${SHOP}`, client);
    const finance = await screen.findByRole('region', { name: 'Finance' });
    await waitFor(() => expect(finance).toHaveTextContent('Outstanding₹42,000.50'));
    // Where the ledger came from, the limit's use, and the ageing in the status colours (D104).
    expect(finance).toHaveTextContent('Ledger from Tally');
    expect(finance).toHaveTextContent('56% of the limit used');
    const ageing = within(finance).getByRole('img', { name: 'Ageing' });
    expect(ageing.parentElement).toHaveTextContent('0–30 days: ₹32,000.50');
    expect(ageing.parentElement).toHaveTextContent('Over 180 days: ₹10,000.00');
    const statement = await within(finance).findByRole('table', { name: 'Statement' });
    expect(within(statement).getByRole('row', { name: /RCPT-1/ })).toHaveTextContent('₹8,000.00');
    expect(finance).toHaveTextContent('Opening balance₹1,000.00');

    const user = userEvent.setup();
    // Printed, the statement stands alone, with its year (D99).
    const printed = await printedText(() =>
      user.click(within(finance).getByRole('button', { name: 'Print' })),
    );
    expect(printed).toContain(`Financial year: ${year}–${year + 1}`);
    expect(printed).toContain('RCPT-1');
    expect(printed).not.toContain('Outstanding');
    expect(printed).not.toContain('Add an entry');
    const form = within(finance).getByRole('form', { name: 'Add an entry' });
    await user.type(within(form).getByRole('textbox', { name: /^Reference/ }), 'RCPT-2');
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Debit or credit' }),
      'credit',
    );
    await user.type(within(form).getByRole('textbox', { name: /^Amount/ }), '500');
    await user.click(within(form).getByRole('button', { name: 'Add an entry' }));
    await waitFor(() =>
      expect(writesOf(client).at(-1)![3]).toEqual({
        body: {
          entries: [
            {
              id: expect.any(String),
              accountId: SHOP,
              date: expect.any(String),
              reference: 'RCPT-2',
              description: null,
              credit: '500',
            },
          ],
        },
        idempotencyKey: expect.any(String),
      }),
    );
  });
});

describe("an account's page", () => {
  it('shows its details, who looks after it, and adds a contact person', async () => {
    const client = fakeClient(
      {
        [`/v1/accounts/${SHOP}/overview`]: OVERVIEW,
        [`/v1/submissions?accountId=${SHOP}`]: {
          items: [
            {
              id: '01a10000-0000-7000-8000-0000000000e1',
              user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
              form: {
                key: 'distributor_visit',
                version: 2,
                name: {
                  en: { one: 'Distributor visit', other: 'Distributor visits' },
                  hi: { one: 'वितरक विज़िट', other: 'वितरक विज़िट' },
                },
              },
              account: { id: SHOP, code: 'D-1', name: 'Green Fields Agro' },
              visitId: '01a10000-0000-7000-8000-0000000000e2',
              shiftId: '01a10000-0000-7000-8000-0000000000e3',
              capturedAt: '2026-10-13T06:00:00.000Z',
              receivedAt: '2026-10-13T06:00:05.000Z',
              location: { lat: 28.6315, lng: 77.2167 },
              accuracy: 12,
              distanceM: 40,
              geofence: 'inside',
              values: {},
              photos: [],
              signatureMediaId: null,
              flags: [],
              status: 'pending',
              autoApproved: false,
            },
          ],
          nextCursor: null,
        },
      },
      {
        [`POST /v1/accounts/${SHOP}/contacts`]: ({ body }) => ({
          ...(body as object),
          accountId: SHOP,
          role: null,
          phone: '+919000000009',
          email: null,
          active: true,
        }),
      },
      MANAGE,
      BUNDLE,
    );
    renderAt(`/accounts/${SHOP}`, client);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Green Fields Agro' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent(
      'Delhi Market (N-DEL)',
    );
    expect(screen.getByRole('region', { name: 'Location' })).toHaveTextContent('No location yet');
    const looking = screen.getByRole('region', { name: 'Who looks after it' });
    expect(within(looking).getByRole('row', { name: /ASM Arjun Singh/ })).toHaveTextContent('Now');

    const filled = screen.getByRole('region', { name: 'Forms filled' });
    const visit = await within(filled).findByRole('row', { name: /Distributor visit/ });
    expect(within(visit).getByRole('link', { name: 'Suresh Rao' })).toBeInTheDocument();
    expect(visit).toHaveTextContent('Inside, 40 m');

    const user = userEvent.setup();
    const contacts = screen.getByRole('region', { name: 'Contact people' });
    expect(within(contacts).getByRole('row', { name: /Meena Shah/ })).toHaveTextContent('Owner');
    await user.click(within(contacts).getByRole('button', { name: 'Add a contact person' }));
    await user.type(within(contacts).getByRole('textbox', { name: /Name/ }), 'Raj Kumar');
    await user.type(within(contacts).getByRole('textbox', { name: 'Mobile' }), '90000 00009');
    await user.click(within(contacts).getByRole('button', { name: 'Add a contact person' }));
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'POST',
          `/v1/accounts/${SHOP}/contacts`,
          expect.anything(),
          {
            body: { id: expect.any(String), name: 'Raj Kumar', phone: '9000000009' },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
  });
});

describe('the account plan (M8)', () => {
  const metric = (key: string, one: string, other: string, unit: string) => ({
    key,
    name: noun(one, other),
    unit,
    direction: 'higher_is_better',
    targetable: true,
  });
  const PLAN = {
    accountId: SHOP,
    period: '2026-10',
    metrics: [
      metric('visits', 'Visit', 'Visits', 'count'),
      metric('sales', 'Sale', 'Sales', 'currency'),
    ],
    values: { visits: '4' },
    updatedAt: '2026-10-02T07:00:00.000Z',
    updatedBy: { id: ASM, name: 'Arjun Singh' },
  };
  const pages = {
    [`/v1/accounts/${SHOP}/overview`]: OVERVIEW,
    '/v1/submissions': { items: [], nextCursor: null },
    '/v1/account-plans': PLAN,
  };

  it('shows the month’s planned values to those who see the account', async () => {
    renderAt(`/accounts/${SHOP}`, fakeClient(pages, {}, ['account.view'], BUNDLE));
    const plan = await screen.findByRole('region', { name: 'Monthly plan' });
    expect(await within(plan).findByText('Visits')).toBeVisible();
    expect(plan).toHaveTextContent('4');
    expect(plan).toHaveTextContent('Last changed by Arjun Singh');
    expect(within(plan).queryByRole('button', { name: 'Save plan' })).toBeNull();
  });

  it('saves changed values for those who manage account plans', async () => {
    const client = fakeClient(
      pages,
      {
        'PUT /v1/account-plans': () => ({ ...PLAN, values: { sales: '25000.50' } }),
      },
      ['account.view', 'account_plan.manage'],
      BUNDLE,
    );
    renderAt(`/accounts/${SHOP}`, client);
    const plan = await screen.findByRole('region', { name: 'Monthly plan' });
    const user = userEvent.setup();
    const sales = await within(plan).findByRole('textbox', { name: 'Sales' });
    await user.type(sales, '25000.505');
    expect(within(plan).getByRole('button', { name: 'Save plan' })).toBeDisabled();
    await user.clear(sales);
    await user.type(sales, '25000.50');
    await user.clear(within(plan).getByRole('textbox', { name: 'Visits' }));
    await user.click(within(plan).getByRole('button', { name: 'Save plan' }));
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'PUT',
          '/v1/account-plans',
          expect.anything(),
          {
            body: {
              accountId: SHOP,
              period: expect.stringMatching(/^\d{4}-\d{2}$/),
              values: { sales: '25000.50', visits: null },
            },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
    expect(await within(plan).findByRole('status')).toHaveTextContent('Plan saved.');
  });
});

describe('the account form', () => {
  it('adds an account, and shows a required slot the server says is empty', async () => {
    const client = fakeClient(
      {
        '/v1/territories': {
          items: [
            {
              id: MARKET,
              parentId: null,
              level: 1,
              code: 'N-DEL',
              name: 'Delhi Market',
              active: true,
            },
          ],
          levels: [],
        },
      },
      {
        'POST /v1/accounts': () => {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'slots.asm', issue: 'Choose someone for this slot' },
          ]);
        },
      },
      MANAGE,
      BUNDLE,
    );
    renderAt('/accounts/new?type=distributor', client);
    expect(await screen.findByRole('heading', { level: 1, name: 'Add Distributor' })).toBeVisible();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Krishi Kendra');
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'D-7');
    await user.selectOptions(screen.getByRole('combobox', { name: /Territory/ }), MARKET);
    await user.type(screen.getByRole('textbox', { name: 'Annual revenue' }), '900000');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Choose someone for this slot')).toBeVisible();
    expect(writesOf(client)[0]![3]).toEqual({
      body: {
        id: expect.any(String),
        type: 'distributor',
        code: 'D-7',
        name: 'Krishi Kendra',
        territoryId: MARKET,
        address: {},
        slots: {},
        custom: { annual_revenue: '900000' },
      },
      idempotencyKey: expect.any(String),
    });
  });
});
