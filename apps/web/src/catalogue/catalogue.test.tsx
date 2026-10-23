import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const NEEM = {
  id: '01a10000-0000-7000-8000-0000000000b0',
  code: 'NEEM-500',
  name: 'Neem Shield 500 ML',
  product: { id: '01a10000-0000-7000-8000-0000000000b1', name: 'Neem Shield' },
  category: { id: '01a10000-0000-7000-8000-0000000000b2', name: 'Bio pesticides' },
  packLabel: '500 ML',
  hsn: '3808',
  taxRate: '18.0000',
  mrp: '450.00',
  baseUnit: 'pack',
  units: [
    { key: 'pack', factor: '1.000' },
    { key: 'case', factor: '20.000' },
  ],
  measureType: 'L',
  measurePerBaseUnit: '0.500000',
  custom: {},
  active: true,
};
const UREA = {
  ...NEEM,
  id: '01a10000-0000-7000-8000-0000000000b3',
  code: 'UREA-1',
  name: 'Urea Plus 1 KG',
  product: { id: '01a10000-0000-7000-8000-0000000000b4', name: 'Urea Plus' },
  category: null,
  packLabel: null,
  taxRate: '5.0000',
  mrp: null,
  units: [{ key: 'pack', factor: '1.000' }],
  active: false,
};
const CATALOGUE = {
  version: 3,
  units: [
    { key: 'pack', name: noun('Pack', 'Packs'), base: true },
    { key: 'case', name: noun('Case', 'Cases'), base: false },
  ],
  measureTypes: ['kg', 'L'],
  items: [NEEM, UREA],
};

describe('the catalogue', () => {
  it('lists items with their units, tax and MRP, and finds them by product', async () => {
    const client = fakeClient({ '/v1/catalogue': CATALOGUE }, {}, [
      'catalogue.manage',
      'import.run',
    ]);
    renderAt('/settings/catalogue', client);
    const table = await screen.findByRole('table', { name: 'Catalogue items' });
    const neem = within(table).getByRole('row', { name: /Neem Shield 500 ML/ });
    expect(neem).toHaveTextContent('Bio pesticides');
    expect(neem).toHaveTextContent('1 Case = 20 Packs');
    expect(neem).toHaveTextContent('18%');
    expect(neem).toHaveTextContent('₹450.00');
    expect(within(table).getByRole('row', { name: /Urea Plus 1 KG/ })).toHaveTextContent(
      'Inactive',
    );
    expect(screen.getByRole('button', { name: 'Import items' })).toBeVisible();

    const user = userEvent.setup();
    await user.type(
      screen.getByRole('searchbox', { name: 'Find by code, name, product or category' }),
      'urea',
    );
    expect(within(table).queryByRole('row', { name: /Neem Shield/ })).toBeNull();
    expect(within(table).getByRole('row', { name: /Urea Plus/ })).toBeVisible();
  });
});

const BUNDLE = {
  catalogue: {
    units: CATALOGUE.units,
    measureTypes: ['kg', 'L'],
    itemFields: [],
    rounding: 'per_unit_first',
  },
};

describe('the item editor', () => {
  it('changes an item, sending its units and measure as the API takes them', async () => {
    const client = fakeClient(
      { '/v1/catalogue': CATALOGUE },
      { [`PUT /v1/items/${NEEM.id}`]: ({ body }) => ({ ...NEEM, ...(body as object) }) },
      ['catalogue.manage'],
      BUNDLE,
    );
    renderAt(`/settings/catalogue/items/${NEEM.id}`, client);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Neem Shield 500 ML' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Packs in a Case' })).toHaveValue('20');
    expect(screen.getByRole('textbox', { name: 'Measure in one Pack' })).toHaveValue('0.5');

    const user = userEvent.setup();
    const name = screen.getByRole('textbox', { name: /^Item name/ });
    await user.clear(name);
    await user.type(name, 'Neem Shield 0.5 L');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]).toEqual([
        'PUT',
        `/v1/items/${NEEM.id}`,
        expect.anything(),
        {
          body: {
            code: 'NEEM-500',
            name: 'Neem Shield 0.5 L',
            productName: 'Neem Shield',
            categoryName: 'Bio pesticides',
            packLabel: '500 ML',
            hsn: '3808',
            taxRate: '18',
            mrp: '450.00',
            baseUnit: 'pack',
            units: [{ key: 'case', factor: '20' }],
            measureType: 'L',
            measurePerBaseUnit: '0.5',
            custom: {},
            active: true,
          },
          idempotencyKey: expect.any(String),
        },
      ]),
    );
  });

  it("shows the API's problems beside the fields they belong to", async () => {
    const client = fakeClient(
      { '/v1/catalogue': CATALOGUE },
      {
        [`PUT /v1/items/${UREA.id}`]: () => {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'code', issue: 'Another item has this code' },
          ]);
        },
      },
      ['catalogue.manage'],
      BUNDLE,
    );
    renderAt(`/settings/catalogue/items/${UREA.id}`, client);
    const user = userEvent.setup();
    const code = await screen.findByRole('textbox', { name: /^Item code/ });
    await user.clear(code);
    await user.type(code, 'NEEM-500');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Another item has this code')).toBeVisible();
  });

  it('starts a new item in the base unit', async () => {
    const client = fakeClient({ '/v1/catalogue': CATALOGUE }, {}, ['catalogue.manage'], BUNDLE);
    renderAt('/settings/catalogue/items/new', client);
    expect(await screen.findByRole('heading', { level: 1, name: 'New item' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Base unit' })).toHaveValue('pack');
    expect(screen.getByRole('button', { name: 'Add an item' })).toBeVisible();
  });
});

const LIST = {
  id: '01a10000-0000-7000-8000-0000000000c0',
  name: 'Standard',
  scope: 'default',
  targets: [],
  priority: 0,
  validFrom: '2026-04-01',
  validTo: null,
  active: true,
  version: 4,
  itemCount: 1,
  updatedAt: '2026-10-20T05:00:00.000Z',
};
const RETAIL = {
  ...LIST,
  id: '01a10000-0000-7000-8000-0000000000c1',
  name: 'Retail',
  scope: 'account_type',
  targets: ['retailer'],
  priority: 2,
  validTo: '2027-03-31',
  itemCount: 0,
};
const ENTRY = {
  item: {
    id: NEEM.id,
    code: 'NEEM-500',
    name: 'Neem Shield 500 ML',
    packLabel: '500 ML',
    baseUnit: 'pack',
    taxRate: '18.0000',
  },
  price: '400.00',
  discount: '10.0000',
  rate: '360.00',
};

describe('price lists', () => {
  it('lists every price list, who it is for and when it applies', async () => {
    const client = fakeClient({ '/v1/price-lists': { items: [LIST, RETAIL] } }, {}, [
      'price_list.manage',
    ]);
    renderAt('/settings/price-lists', client);
    const table = await screen.findByRole('table', { name: 'Price lists' });
    expect(within(table).getByRole('row', { name: /Standard/ })).toHaveTextContent(
      'Everyone (default)',
    );
    const retail = within(table).getByRole('row', { name: /Retail/ });
    expect(retail).toHaveTextContent('Account types: 1');
    expect(retail).toHaveTextContent('1 Apr 2026 to 31 Mar 2027');
  });

  it('sets a price at the version it saw, previewing the net rate, and removes one after asking', async () => {
    const client = fakeClient(
      {
        '/v1/catalogue': CATALOGUE,
        [`/v1/price-lists/${LIST.id}`]: LIST,
        [`/v1/price-lists/${LIST.id}/items`]: { items: [ENTRY], nextCursor: null },
      },
      { [`PUT /v1/price-lists/${LIST.id}/items`]: () => ({ ...LIST, version: 5 }) },
      ['price_list.manage'],
      BUNDLE,
    );
    renderAt(`/settings/price-lists/${LIST.id}`, client);
    const table = await screen.findByRole('table', { name: 'Prices on Standard' });
    const row = within(table).getByRole('row', { name: /Neem Shield/ });
    expect(row).toHaveTextContent('₹400.00');
    expect(row).toHaveTextContent('10%');
    expect(row).toHaveTextContent('₹360.00');

    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: 'Set the price' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Item' }), NEEM.id);
    await user.type(within(form).getByRole('textbox', { name: 'Price per base unit' }), '99.99');
    await user.type(within(form).getByRole('textbox', { name: 'Discount (%)' }), '12.5');
    expect(within(form).getByText('Net rate ₹87.49')).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Set the price' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toEqual({
        body: { set: [{ itemId: NEEM.id, price: '99.99', discount: '12.5' }], version: 4 },
        idempotencyKey: expect.any(String),
      }),
    );

    await user.click(
      within(row).getByRole('button', { name: 'Remove Neem Shield 500 ML from the list' }),
    );
    const confirm = screen.getByRole('group', {
      name: 'Remove Neem Shield 500 ML from this list?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(writesOf(client)[1]![3]).toEqual({
        body: { remove: [NEEM.id], version: 4 },
        idempotencyKey: expect.any(String),
      }),
    );
  });
});
