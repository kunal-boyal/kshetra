import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const NEEM = '01a10000-0000-7000-8000-0000000000b0';
const PESTICIDES = '01a10000-0000-7000-8000-0000000000b2';
const SCHEME = '01a10000-0000-7000-8000-0000000000e1';

const CATALOGUE = {
  version: 1,
  units: [{ key: 'pack', name: noun('Pack', 'Packs'), base: true }],
  measureTypes: [],
  items: [
    {
      id: NEEM,
      code: 'NEEM-500',
      name: 'Neem Shield',
      product: { id: '01a10000-0000-7000-8000-0000000000b1', name: 'Neem Shield' },
      category: { id: PESTICIDES, name: 'Bio pesticides' },
      packLabel: null,
      hsn: null,
      taxRate: '18.0000',
      mrp: null,
      baseUnit: 'pack',
      units: [{ key: 'pack', factor: '1.000' }],
      measureType: null,
      measurePerBaseUnit: null,
      custom: {},
      active: true,
    },
  ],
};

const scheme = (overrides: Record<string, unknown> = {}) => ({
  id: SCHEME,
  key: 'volume',
  name: { en: 'Monsoon volume', hi: 'मानसून मात्रा' },
  kind: 'slabs',
  rule: {
    slabs: [
      { from: '100', percent: '2' },
      { from: '250', percent: '4' },
    ],
  },
  itemIds: [],
  categoryIds: [PESTICIDES],
  accountTypeKeys: [],
  territoryIds: [],
  validFrom: '2026-06-01',
  validTo: '2026-09-30',
  active: true,
  version: 2,
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

const pages = (items: unknown[]) => ({
  '/v1/schemes': { items },
  '/v1/catalogue': CATALOGUE,
  '/v1/account-types': { items: [] },
  '/v1/territories': { items: [] },
});

describe('schemes (D127)', () => {
  it('lists each scheme with what it gives, whom it reaches and when', async () => {
    renderAt('/settings/schemes', fakeClient(pages([scheme()]), {}, ['scheme.manage']));
    const table = await screen.findByRole('table', { name: 'Schemes' });
    const row = within(table).getByRole('row', { name: /Monsoon volume/ });
    expect(row).toHaveTextContent('2% from 100 · 4% from 250');
    expect(row).toHaveTextContent('1 category');
    expect(row).toHaveTextContent('Active');
  });

  it('adds a scheme, working an example out as it is typed', async () => {
    const client = fakeClient(pages([]), { [`PUT /v1/schemes/:id`]: () => scheme() }, [
      'scheme.manage',
    ]);
    // The fake answers writes by method and path; a new scheme's path carries its own ID.
    client.request.mockImplementation(async (method: string, path: string, _schema, options) => {
      if (method === 'PUT') return scheme({ ...(options as { body: object }).body, id: SCHEME });
      const page = (pages([]) as Record<string, unknown>)[path.split('?')[0]!];
      if (page === undefined) throw new ApiError(404, 'NOT_FOUND', path);
      return page;
    });
    renderAt('/settings/schemes/new', client);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /^Key/ }), 'five_off');
    await user.type(screen.getByRole('textbox', { name: /Name in English/ }), 'Five off');
    await user.type(screen.getByRole('textbox', { name: /Percent off/ }), '5');
    // 100 units at 100: 5% is ₹500.00 off.
    expect(screen.getByRole('status')).toHaveTextContent(
      '₹500.00 off, leaving ₹9,500.00 before tax',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Bio pesticides' }));
    await user.click(screen.getByRole('button', { name: 'Add a scheme' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        key: 'five_off',
        name: { en: 'Five off', hi: 'Five off' },
        kind: 'percentage',
        rule: { percent: '5' },
        categoryIds: [PESTICIDES],
        itemIds: [],
        validTo: null,
        active: true,
      },
    });
  });

  it('changes a scheme at its version, keeps its key, and shows what the server refused', async () => {
    const client = fakeClient(
      pages([scheme()]),
      {
        [`PUT /v1/schemes/${SCHEME}`]: () => {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'rule.slabs.2.percent', issue: 'Give more than the slab before' },
          ]);
        },
      },
      ['scheme.manage'],
    );
    renderAt(`/settings/schemes/${SCHEME}`, client);
    const user = userEvent.setup();
    expect(await screen.findByRole('textbox', { name: /^Key/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add a slab' }));
    await user.type(screen.getByRole('textbox', { name: 'Slab 3: from units' }), '500');
    await user.type(screen.getByRole('textbox', { name: 'Slab 3: percent off' }), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Give more than the slab before')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        key: 'volume',
        version: 2,
        rule: {
          slabs: [
            { from: '100', percent: '2' },
            { from: '250', percent: '4' },
            { from: '500', percent: '3' },
          ],
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Remove slab 3' }));
    expect(screen.queryByRole('textbox', { name: 'Slab 3: from units' })).toBeNull();
  });
});
