import { ApiError } from '@kshetra/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const SHOP = '01a10000-0000-7000-8000-000000000080';
const DEPOT = '01a10000-0000-7000-8000-000000000081';
const MARKET = '01a10000-0000-7000-8000-000000000010';
const ASM = '01a10000-0000-7000-8000-000000000003';
const SME = '01a10000-0000-7000-8000-000000000004';
const APPROVAL = '01a10000-0000-7000-8000-000000000090';
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
            }),
          ],
          nextCursor: null,
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
    expect(shop).toHaveTextContent('Commercially active');
    expect(within(table).getByRole('columnheader', { name: 'Annual revenue' })).toBeVisible();
    const depot = within(table).getByRole('row', { name: /Beej Bhandar/ });
    expect(depot).toHaveTextContent('Waiting for approval');
    expect(depot).toHaveTextContent('Needs ASM');
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/v1/accounts?type=distributor&limit=50',
      expect.anything(),
    );

    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'farmer');
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        '/v1/accounts?type=farmer&limit=50',
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Farmers' })).toBeVisible();
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
            body: { id: expect.any(String), name: 'Raj Kumar', phone: '90000 00009' },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
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

describe('the approvals inbox', () => {
  const REQUEST = {
    id: APPROVAL,
    requestType: 'new_account',
    requestId: DEPOT,
    subject: { title: 'Beej Bhandar (D-81)', accountId: DEPOT },
    requester: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
    status: 'pending',
    version: 1,
    steps: [],
    createdAt: '2026-10-12T05:00:00.000Z',
    closedAt: null,
  };

  it('approves with the version it saw, and rejects only with a reason', async () => {
    const client = fakeClient(
      { '/v1/approvals/inbox': { items: [REQUEST], nextCursor: null } },
      {
        [`POST /v1/approvals/${APPROVAL}/decision`]: ({ body }) => {
          const { decision, note } = body as { decision: string; note?: string };
          if (decision === 'reject' && (note?.length ?? 0) < 3) {
            throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
              { path: 'note', issue: 'Say why, in at least 3 characters' },
            ]);
          }
          return {
            ...REQUEST,
            status: decision === 'approve' ? 'approved' : 'rejected',
            version: 2,
          };
        },
      },
      ['approval.act', 'account.view'],
      BUNDLE,
    );
    renderAt('/approvals', client);
    const request = await screen.findByRole('article', { name: 'Beej Bhandar (D-81)' });
    expect(request).toHaveTextContent('New account');
    expect(request).toHaveTextContent('Asked by Suresh Rao');

    const user = userEvent.setup();
    await user.click(within(request).getByRole('button', { name: 'Reject' }));
    await user.type(
      within(request).getByRole('textbox', { name: /Why are you rejecting it/ }),
      'no',
    );
    await user.click(within(request).getByRole('button', { name: 'Reject' }));
    expect(await within(request).findByText('Say why, in at least 3 characters')).toBeVisible();

    await user.click(within(request).getByRole('button', { name: 'Cancel' }));
    await user.click(within(request).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(writesOf(client).at(-1)).toEqual([
        'POST',
        `/v1/approvals/${APPROVAL}/decision`,
        expect.anything(),
        { body: { decision: 'approve', version: 1 }, idempotencyKey: expect.any(String) },
      ]),
    );
  });
});
