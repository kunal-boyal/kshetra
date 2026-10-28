import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, printedText, renderAt, writesOf } from '../test-support';

const ORDER = '01a10000-0000-7000-8000-0000000000f0';
const SHOP = '01a10000-0000-7000-8000-000000000080';
const SME = '01a10000-0000-7000-8000-000000000004';
const NEEM = '01a10000-0000-7000-8000-0000000000b0';
const UREA = '01a10000-0000-7000-8000-0000000000b3';
const LIST = '01a10000-0000-7000-8000-0000000000c0';
const APPROVAL = '01a10000-0000-7000-8000-000000000090';
const NEEM_LINE = '01a10000-0000-7000-8000-0000000000f1';
const UREA_LINE = '01a10000-0000-7000-8000-0000000000f2';

const BUNDLE = {
  catalogue: {
    units: [
      { key: 'pack', name: noun('Pack', 'Packs'), base: true },
      { key: 'case', name: noun('Case', 'Cases'), base: false },
    ],
    measureTypes: ['L'],
    itemFields: [],
    rounding: 'per_unit_first',
    rejectionReasons: [],
  },
};

function line(id: string, itemId: string, code: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    position: 1,
    item: {
      id: itemId,
      code,
      name: `${code} item`,
      packLabel: '500 ML',
      hsn: '3808',
      mrp: '450.00',
      baseUnit: 'pack',
    },
    unitKey: 'case',
    quantity: '2.000',
    factor: '12.000',
    baseUnits: '24.000',
    measureType: 'L',
    measure: '12.000',
    priceListId: LIST,
    price: '400.00',
    discount: '10.0000',
    taxRate: '18.0000',
    rate: '360.00',
    taxable: '8640.00',
    tax: '1555.20',
    total: '10195.20',
    decision: 'pending',
    decisionReason: null,
    fulfilledUnits: null,
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    number: 1187,
    account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
    supplier: { kind: 'company', account: null },
    placedBy: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
    visitId: null,
    placedAt: '2026-10-20T05:00:00.000Z',
    receivedAt: '2026-10-20T05:00:03.000Z',
    note: 'Before the rains',
    photos: [],
    status: 'submitted',
    rejectionReason: null,
    lines: [
      line(NEEM_LINE, NEEM, 'NEEM'),
      line(UREA_LINE, UREA, 'UREA', {
        position: 2,
        quantity: '3.000',
        baseUnits: '36.000',
        price: '90.23',
        discount: '0.0000',
        rate: '90.23',
        taxable: '3248.28',
        tax: '584.69',
        total: '3832.97',
      }),
    ],
    totals: {
      taxable: '11888.28',
      tax: '2139.89',
      total: '14028.17',
      cgst: '1069.95',
      sgst: '1069.94',
    },
    measures: { L: '30.000' },
    approval: {
      id: APPROVAL,
      requestType: 'order',
      requestId: ORDER,
      subject: { title: 'Beej Bhandar (D-81)', accountId: SHOP, detail: null },
      requester: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
      status: 'pending',
      version: 3,
      steps: [],
      cancellable: false,
      bulk: false,
      page: `/orders/${ORDER}`,
      createdAt: '2026-10-20T05:00:00.000Z',
      closedAt: null,
    },
    can: { decide: true, decideLines: false, fulfil: false },
    version: 1,
    history: [
      {
        kind: 'placed',
        at: '2026-10-20T05:00:00.000Z',
        by: { id: SME, name: 'Suresh Rao' },
        offline: true,
      },
      {
        kind: 'approved',
        at: '2026-10-20T07:00:00.000Z',
        by: { id: '01a10000-0000-7000-8000-000000000003', name: 'Priya Nair' },
        offline: false,
      },
    ],
    ...overrides,
  };
}

describe('the orders register (decision D104)', () => {
  const summary = (id: string, number: number, status: string, total: string) => ({
    id,
    number,
    account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
    placedBy: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
    placedAt: '2026-10-20T05:00:00.000Z',
    status,
    lineCount: 2,
    total,
  });
  const REGISTER = {
    items: [
      summary(ORDER, 1187, 'partially_accepted', '14028.17'),
      summary('01a10000-0000-7000-8000-0000000000f1', 1186, 'fulfilled', '2500.00'),
    ],
    nextCursor: null,
    summary: {
      counts: { partially_accepted: 1, fulfilled: 1, cancelled: 1 },
      orders: 3,
      value: '16528.17',
    },
  };

  it('heads the month with its orders and value, and chips with their counts', async () => {
    const client = fakeClient({ '/v1/orders': REGISTER, [`/v1/orders/${ORDER}`]: order() }, {}, [
      'order.view',
      'order.create',
    ]);
    renderAt('/orders', client);
    expect(await screen.findByText(/ · 3 orders · ₹16,528.17$/)).toBeVisible();
    const chips = screen.getByRole('group', { name: 'Status' });
    expect(within(chips).getByRole('button', { name: 'Fulfilled · 1' })).toBeVisible();
    expect(within(chips).getByRole('button', { name: 'Rejected · 0' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'New order' })).toBeVisible();

    await userEvent.setup().click(within(chips).getByRole('button', { name: 'Fulfilled · 1' }));
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(/^\/v1\/orders\?status=fulfilled&period=\d{4}-\d{2}$/),
        expect.anything(),
      ),
    );
  });

  it('previews the chosen order with its lines, total and timeline, and opens it', async () => {
    renderAt(
      '/orders',
      fakeClient({ '/v1/orders': REGISTER, [`/v1/orders/${ORDER}`]: order() }, {}, ['order.view']),
    );
    const table = await screen.findByRole('table', { name: 'Orders' });
    const [first] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveTextContent('1187');
    expect(first).toHaveTextContent('₹14,028.17');
    const preview = await screen.findByRole('complementary', { name: 'Order 1187' });
    expect(await within(preview).findByRole('heading', { name: 'Order 1187' })).toBeVisible();
    expect(preview).toHaveTextContent('Beej Bhandar · D-81 · by Suresh Rao');
    expect(within(preview).getByText('₹14,028.17', { selector: 'b' })).toBeVisible();
    const timeline = within(preview).getByRole('list', { name: 'What happened' });
    expect(
      within(timeline)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual([
      expect.stringMatching(/^Placed by Suresh Rao.* · taken offline, sent later$/),
      expect.stringMatching(/^Approved by Priya Nair/),
    ]);
    expect(within(preview).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/orders/${ORDER}`,
    );
  });

  it('says so for a month without orders', async () => {
    renderAt(
      '/orders',
      fakeClient(
        {
          '/v1/orders': {
            items: [],
            nextCursor: null,
            summary: { counts: {}, orders: 0, value: '0.00' },
          },
        },
        {},
        ['order.view'],
      ),
    );
    expect(await screen.findByText(/ · no orders$/)).toBeVisible();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('an order', () => {
  it('shows each line as priced, GST in halves, and rejects only with a reason', async () => {
    const client = fakeClient(
      { [`/v1/orders/${ORDER}`]: order() },
      {
        [`POST /v1/orders/${ORDER}/decision`]: ({ body }) => {
          if (!(body as { reason?: string }).reason) {
            throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
              { path: 'reason', issue: 'Choose why it is rejected' },
            ]);
          }
          return order({
            status: 'rejected',
            rejectionReason: 'overdue',
            can: { decide: false, decideLines: false, fulfil: false },
            version: 2,
          });
        },
      },
      ['order.view', 'order.decide'],
      BUNDLE,
    );
    renderAt(`/orders/${ORDER}`, client);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Order 1187 · Beej Bhandar' }),
    ).toBeVisible();
    expect(screen.getByText(/doesn't create an invoice/)).toBeVisible();
    const lines = screen.getByRole('table', { name: 'Lines' });
    expect(within(lines).getByRole('row', { name: /NEEM item/ })).toHaveTextContent('₹360.00');
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(totals).toHaveTextContent('CGST₹1,069.95');
    expect(totals).toHaveTextContent('SGST₹1,069.94');
    expect(totals).toHaveTextContent('Volume (L)30');

    const user = userEvent.setup();
    // Printed, it holds the order and its totals, but none of the decisions (D99).
    const printed = await printedText(() =>
      user.click(screen.getByRole('button', { name: 'Print' })),
    );
    expect(printed).toContain('Sunrise Traders');
    expect(printed).toContain(`Reference ${ORDER}`);
    expect(printed).toContain('CGST₹1,069.95');
    expect(printed).not.toContain('Reason');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'overdue');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toEqual({
        body: { decision: 'reject', reason: 'overdue', version: 3 },
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('decides line by line at a step that does, with a reason for each rejected line', async () => {
    const client = fakeClient(
      {
        [`/v1/orders/${ORDER}`]: order({
          can: { decide: true, decideLines: true, fulfil: false },
        }),
      },
      {
        [`POST /v1/orders/${ORDER}/line-decisions`]: () => order({ status: 'partially_accepted' }),
      },
      ['order.view', 'order.decide', 'order.line_decide'],
      BUNDLE,
    );
    renderAt(`/orders/${ORDER}`, client);
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Decision on UREA item' }),
      'rejected',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'no_stock');
    await user.click(screen.getByRole('button', { name: 'Save the decisions' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toEqual({
        body: {
          lines: [
            { lineId: NEEM_LINE, decision: 'accepted' },
            { lineId: UREA_LINE, decision: 'rejected', reason: 'no_stock' },
          ],
          version: 3,
        },
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('records fulfilment at the order’s version', async () => {
    const accepted = order({
      status: 'partially_accepted',
      lines: [
        line(NEEM_LINE, NEEM, 'NEEM', { decision: 'accepted' }),
        line(UREA_LINE, UREA, 'UREA', { decision: 'rejected', decisionReason: 'no_stock' }),
      ],
      can: { decide: false, decideLines: false, fulfil: true },
      version: 4,
    });
    const client = fakeClient(
      { [`/v1/orders/${ORDER}`]: accepted },
      { [`POST /v1/orders/${ORDER}/fulfilment`]: () => ({ ...accepted, status: 'fulfilled' }) },
      ['order.view', 'order.fulfil'],
      BUNDLE,
    );
    renderAt(`/orders/${ORDER}`, client);
    const units = await screen.findByRole('textbox', { name: 'NEEM item: of 24.000 pack' });
    expect(screen.getByText('No stock')).toBeVisible();
    const user = userEvent.setup();
    await user.clear(units);
    await user.type(units, '24');
    await user.click(screen.getByRole('button', { name: 'Save fulfilment' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toEqual({
        body: {
          action: 'fulfil',
          lines: [{ lineId: NEEM_LINE, fulfilledUnits: '24' }],
          version: 4,
        },
        idempotencyKey: expect.any(String),
      }),
    );
  });
});

describe('the order desk', () => {
  const RETAILER = {
    id: '01a10000-0000-7000-8000-000000000070',
    version: 1,
    key: 'retailer',
    name: noun('Retailer', 'Retailers'),
    icon: 'store',
    active: true,
    parentTypes: [],
    code: { mode: 'manual' },
    fields: [],
    location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: false },
    creation: 'admins',
    slots: [],
    segmentRules: [],
    visitFrequencyNorms: [],
    contacts: true,
  };
  const item = (id: string, code: string) => ({
    id,
    code,
    name: `${code} item`,
    product: { id: '01a10000-0000-7000-8000-0000000000d0', name: 'Field care' },
    category: null,
    packLabel: null,
    hsn: null,
    taxRate: '18.0000',
    mrp: null,
    baseUnit: 'pack',
    units: [
      { key: 'pack', factor: '1.000' },
      { key: 'case', factor: '12.000' },
    ],
    measureType: null,
    measurePerBaseUnit: null,
    custom: {},
    active: true,
  });

  it('prices lines as the server will, and shows changed prices again', async () => {
    let placed = 0;
    const client = fakeClient(
      {
        '/v1/account-types': { items: [RETAILER] },
        '/v1/accounts': {
          items: [{ id: SHOP, code: 'R-1', name: 'Sharma Agro' }],
          nextCursor: null,
        },
        '/v1/catalogue': {
          version: 1,
          units: BUNDLE.catalogue.units,
          measureTypes: [],
          items: [item(NEEM, 'NEEM'), item(UREA, 'UREA')],
        },
        [`/v1/accounts/${SHOP}/prices`]: {
          date: '2026-10-24',
          lists: [{ id: LIST, name: 'Standard', scope: 'default' }],
          items: [
            { itemId: NEEM, listId: LIST, price: '400.00', discount: '10.0000', rate: '360.00' },
          ],
        },
      },
      {
        'POST /v1/orders': () => {
          placed += 1;
          throw new ApiError(409, 'PRICE_CHANGED', 'Prices changed.', [
            { path: 'lines[0].discount', issue: 'Now 12.0000' },
          ]);
        },
      },
      ['order.create', 'order.view', 'account.view'],
      BUNDLE,
    );
    renderAt('/orders/new', client);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: 'Find by name or code' }),
      'sharma',
    );
    await user.click(await screen.findByRole('button', { name: 'Sharma Agro (R-1)' }));

    const add = await screen.findByRole('form', { name: 'Add' });
    // Only what a list prices here is offered.
    await waitFor(() =>
      expect(
        within(add)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Choose an item', 'NEEM item (NEEM)']),
    );
    await user.selectOptions(within(add).getByRole('combobox', { name: 'Item' }), NEEM);
    await user.selectOptions(within(add).getByRole('combobox', { name: 'Unit' }), 'case');
    await user.type(within(add).getByRole('textbox', { name: 'Quantity' }), '2');
    await user.click(within(add).getByRole('button', { name: 'Add' }));

    // FX-07, worked out on the page.
    const lines = screen.getByRole('table', { name: 'Lines' });
    expect(within(lines).getByRole('row', { name: /NEEM item/ })).toHaveTextContent('₹10,195.20');
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(totals).toHaveTextContent('CGST₹777.60');
    expect(totals).toHaveTextContent('Total₹10,195.20');

    await user.click(screen.getByRole('button', { name: 'Place the order' }));
    expect(
      await screen.findByText(
        'Prices changed since they were shown. Check the lines and place it again.',
      ),
    ).toBeVisible();
    expect(placed).toBe(1);
    const [, , , options] = client.request.mock.calls.find(([method]) => method === 'POST')!;
    expect((options as { body: { lines: unknown[] } }).body.lines).toEqual([
      {
        itemId: NEEM,
        unitKey: 'case',
        quantity: '2',
        quoted: {
          listId: LIST,
          price: '400.00',
          discount: '10.0000',
          taxRate: '18.0000',
          factor: '12.000',
        },
      },
    ]);
  });
});
