import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt } from '../test-support';

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
