import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@thelamp/api-client';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const MANAGER = '01a10000-0000-7000-8000-0000000000c1';
const FIELD = '01a10000-0000-7000-8000-0000000000c2';

const LAYOUTS = {
  items: [
    {
      role: { id: MANAGER, key: 'manager', name: { en: 'Manager', hi: 'मैनेजर' } },
      cards: null,
      updatedAt: null,
    },
    {
      role: { id: FIELD, key: 'field_user', name: { en: 'Field user', hi: 'फ़ील्ड यूज़र' } },
      cards: [{ kind: 'waiting' }],
      updatedAt: '2026-11-01T06:00:00.000Z',
    },
  ],
  metrics: [
    { key: 'visits', name: noun('Visit', 'Visits'), additive: true },
    { key: 'coverage', name: noun('Coverage', 'Coverage'), additive: false },
  ],
  levels: [
    { key: 'region', name: noun('Region', 'Regions') },
    { key: 'area', name: noun('Area', 'Areas') },
  ],
};

describe('Settings › Dashboards (D122)', () => {
  it('lays out a role’s Home from the standard cards, moved and changed', async () => {
    const client = fakeClient(
      { '/v1/dashboard-layouts': LAYOUTS },
      {
        [`PUT /v1/dashboard-layouts/${MANAGER}`]: (options) => ({
          role: LAYOUTS.items[0]!.role,
          cards: (options.body as { cards: unknown }).cards,
          updatedAt: '2026-11-01T07:00:00.000Z',
        }),
      },
      ['dashboard.manage', 'settings.manage'],
    );
    renderAt('/settings/dashboards', client);
    const user = userEvent.setup();
    expect(await screen.findByText('Manager sees the standard Home')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Lay out this Home' }));
    const cards = screen.getByRole('list', { name: 'Cards on the Manager Home' });
    // The standard Home: tiles, a trend, the leaderboard, on duty, waiting and forms.
    expect(
      within(cards)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual([
      '1. Metric tiles',
      '2. Day-by-day trend',
      '3. Leaderboard',
      '4. Who is on duty',
      '5. Waiting for you',
      '6. Forms filled',
    ]);
    // A trend offers only metrics whose days add up.
    const trend = within(cards).getAllByRole('listitem')[1]!;
    expect(within(trend).queryByRole('checkbox', { name: 'Coverage' })).toBeNull();
    await user.click(within(cards).getByRole('button', { name: 'Take out card 3, Leaderboard' }));
    await user.click(within(cards).getByRole('button', { name: 'Move card 5, Forms filled, up' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Add a card' }), 'breakdown');
    const added = within(cards).getAllByRole('listitem').at(-1)!;
    await user.selectOptions(
      within(added).getByRole('combobox', { name: 'Split by' }),
      'territory',
    );
    await user.selectOptions(within(added).getByRole('combobox', { name: 'Level' }), 'area');
    // Leaderboard can come back; the cards still there can't be added twice.
    const add = screen.getByRole('combobox', { name: 'Add a card' });
    expect(within(add).getByRole('option', { name: 'Leaderboard' })).toBeInTheDocument();
    expect(within(add).queryByRole('option', { name: 'Waiting for you' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save the layout' }));
    expect(await screen.findByText(/Everyone with the Manager role sees this Home/)).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        cards: [
          { kind: 'tiles', metrics: ['visits', 'coverage'] },
          { kind: 'trend', metrics: ['visits'] },
          { kind: 'on_duty' },
          { kind: 'mix' },
          { kind: 'waiting' },
          { kind: 'breakdown', metric: 'visits', by: 'territory', level: 'area' },
        ],
      },
    });
  });

  it('shows a refusal at its card, and gives a role back the standard Home', async () => {
    const client = fakeClient(
      { '/v1/dashboard-layouts': LAYOUTS },
      {
        [`PUT /v1/dashboard-layouts/${FIELD}`]: (options) => {
          const cards = (options.body as { cards: unknown }).cards;
          if (cards) {
            throw new ApiError(400, 'VALIDATION', 'The layout names something that is not there.', [
              { path: 'cards[1].metrics[0]', issue: 'There is no metric gone' },
            ]);
          }
          return {
            role: LAYOUTS.items[1]!.role,
            cards: null,
            updatedAt: '2026-11-01T07:00:00.000Z',
          };
        },
      },
      ['dashboard.manage'],
    );
    renderAt('/settings/dashboards', client);
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role' }),
      'Field user (laid out)',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Add a card' }), 'tiles');
    await user.click(screen.getByRole('button', { name: 'Save the layout' }));
    expect(await screen.findByText('There is no metric gone')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Use the standard Home' }));
    const confirm = screen.getByRole('group', { name: /Give the Field user role/ });
    await user.click(within(confirm).getByRole('button', { name: 'Use the standard Home' }));
    await waitFor(() =>
      expect(writesOf(client).at(-1)![3]).toMatchObject({ body: { cards: null } }),
    );
    expect(await screen.findByText('Field user sees the standard Home')).toBeVisible();
  });
});
