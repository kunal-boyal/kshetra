import { todayIn } from '@thelamp/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const FUEL = {
  key: 'fuel',
  name: { en: 'Fuel', hi: 'ईंधन' },
  category: 'travel',
  calculation: 'per_km',
  rate: { flat: '3.50' },
  caps: {},
  receiptRequired: false,
  odometerPhotosRequired: true,
  active: true,
  version: 1,
  validFrom: '2000-01-01',
};
const DESIGNATIONS = [
  { key: 'manager', name: noun('Manager', 'Managers'), level: 2, ranked: true },
  { key: 'executive', name: noun('Executive', 'Executives'), level: 3, ranked: true },
];

describe('expense policies (M12, spec 5.10)', () => {
  it('changes a rate from a day and adds a policy paid by designation', async () => {
    const client = fakeClient(
      { '/v1/expense-policies': { items: [FUEL] } },
      {
        'PUT /v1/expense-policies': ({ body }) => ({
          items: (body as { items: object[] }).items.map((item) => ({
            ...item,
            version: 1,
            validFrom: '2000-01-01',
          })),
        }),
      },
      ['expense_policy.manage'],
      { designations: DESIGNATIONS },
    );
    renderAt('/settings/expense-policies', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Expense policies' });
    const cards = () => within(list).getAllByRole('listitem');
    const fuel = cards()[0]!;
    expect(within(fuel).getByRole('textbox', { name: /^Key/ })).toHaveAttribute('readonly');
    const rate = within(fuel).getByRole('textbox', { name: /^Rate/ });
    await user.clear(rate);
    await user.type(rate, '4');
    // A per-km policy says where its kilometres come from (decision D115).
    const kmFrom = within(fuel).getByRole('combobox', { name: /^Kilometres from/ });
    expect(kmFrom).toHaveValue('odometer');
    await user.selectOptions(kmFrom, 'tracked');

    await user.click(screen.getByRole('button', { name: 'Add a policy' }));
    const da = cards()[1]!;
    await user.type(within(da).getByRole('textbox', { name: /^Key/ }), 'da');
    await user.type(
      within(da).getByRole('textbox', { name: /^Name in English/ }),
      'Daily allowance',
    );
    await user.selectOptions(
      within(da).getByRole('combobox', { name: 'Category' }),
      'daily_allowance',
    );
    await user.selectOptions(within(da).getByRole('combobox', { name: 'Pays' }), 'per_day');
    // Odometer photos are for per-km policies only.
    expect(within(da).queryByRole('checkbox', { name: /odometer/ })).toBeNull();
    expect(within(da).queryByRole('combobox', { name: /^Kilometres from/ })).toBeNull();
    await user.selectOptions(within(da).getByRole('combobox', { name: 'Rate' }), 'by');
    await user.type(within(da).getByRole('textbox', { name: /^Rate for Executive/ }), '250');
    await user.type(within(da).getByRole('textbox', { name: /^Cap per claim/ }), '1200');
    const from = screen.getByLabelText(/^Changes apply from/);
    expect(from).toHaveValue(todayIn('Asia/Kolkata'));
    await user.click(screen.getByRole('button', { name: 'Save policies' }));

    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        from: todayIn('Asia/Kolkata'),
        items: [
          { key: 'fuel', kmFrom: 'tracked', rate: { flat: '4' }, odometerPhotosRequired: true },
          {
            key: 'da',
            name: { en: 'Daily allowance', hi: 'Daily allowance' },
            category: 'daily_allowance',
            calculation: 'per_day',
            rate: { byDesignation: { executive: '250' } },
            caps: { perClaim: '1200' },
            receiptRequired: false,
            odometerPhotosRequired: false,
            active: true,
          },
        ],
      },
    });
    expect(
      (writesOf(client)[0]![3] as { body: { items: object[] } }).body.items[1],
    ).not.toHaveProperty('kmFrom');
  });
});
