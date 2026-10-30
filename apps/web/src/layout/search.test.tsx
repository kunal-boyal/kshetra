import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt } from '../test-support';

const NOTIFICATIONS = { items: [], nextCursor: null, unread: 0 };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const SHOP = '01a10000-0000-7000-8000-000000000009';

const FOUND = {
  people: [
    { id: ASHA, code: 'SUN-004', name: 'Asha Verma', designation: 'executive', status: 'active' },
  ],
  accounts: [{ id: SHOP, code: 'C-101', name: 'Asha Stores', type: 'customer', status: 'active' }],
  orders: [],
  forms: null,
};

describe('search in the bar (phase 4 step A1, D110)', () => {
  it('finds screens at once and people and accounts from the server, grouped, and opens one', async () => {
    const client = fakeClient({ '/v1/notifications': NOTIFICATIONS, '/v1/search': FOUND }, {}, [
      'user.view',
      'account.view',
    ]);
    const router = renderAt('/notifications', client);
    const user = userEvent.setup();
    const box = await screen.findByRole('combobox', { name: 'Search' });
    await user.type(box, 'as');
    const list = screen.getByRole('listbox', { name: 'Search results' });
    const people = await within(list).findByRole('group', { name: 'People' });
    expect(within(people).getByRole('option', { name: /Asha Verma/ })).toBeVisible();
    expect(within(list).getByRole('group', { name: 'Accounts' })).toHaveTextContent('Asha Stores');
    // Orders found nothing and forms aren't the person's to search, so neither shows.
    expect(within(list).queryByRole('group', { name: 'Orders' })).toBeNull();
    expect(within(list).queryByRole('group', { name: 'Forms' })).toBeNull();
    expect(client.request.mock.calls.map(([method, path]) => `${method} ${path}`)).toContain(
      'GET /v1/search?q=as',
    );
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/accounts/${SHOP}`));
  });

  it('opens a screen by its name, without asking the server for one letter', async () => {
    const client = fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['user.view']);
    const router = renderAt('/notifications', client);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'p');
    const screens = screen.getByRole('group', { name: 'Screens' });
    expect(within(screens).getByRole('option', { name: 'People' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/people'));
    expect(
      client.request.mock.calls.some(([, path]) => String(path).startsWith('/v1/search')),
    ).toBe(false);
  });

  it('says when nothing matches, closes on Escape, and takes focus on /', async () => {
    const client = fakeClient(
      {
        '/v1/notifications': NOTIFICATIONS,
        '/v1/search': { people: [], accounts: [], orders: [], forms: null },
      },
      {},
      ['user.view', 'account.view'],
    );
    renderAt('/notifications', client);
    const user = userEvent.setup();
    const box = await screen.findByRole('combobox', { name: 'Search' });
    await user.keyboard('/');
    expect(box).toHaveFocus();
    await user.type(box, 'zzz');
    expect(await screen.findByText('Nothing matches “zzz”.')).toBeVisible();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });
});
