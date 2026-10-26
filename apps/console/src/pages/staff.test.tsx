import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderConsole } from '../test-support';

const RAVI = {
  ...ADMIN,
  id: '01a10000-0000-7000-8000-0000000000a2',
  email: 'ravi@vendor.example',
  name: 'Ravi Shah',
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

describe('vendor staff in the console (D88)', () => {
  it('invites someone, showing the setup link once, and disables someone after asking', async () => {
    let people = [ADMIN, RAVI];
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'POST' && path === '/platform/v1/staff') {
        const invited = { ...RAVI, ...(body as object), status: 'invited' as const };
        people = [...people, invited];
        return { staff: invited, setupUrl: 'https://console.example/setup#secret-link' };
      }
      if (method === 'POST' && path.endsWith('/disable')) {
        people = people.map((one) =>
          one.id === RAVI.id ? { ...one, status: 'disabled' as const } : one,
        );
        return people.find((one) => one.id === RAVI.id);
      }
      return { items: people };
    });
    renderConsole('/staff', client);
    const table = await screen.findByRole('table', { name: 'Staff' });
    // Nobody disables themselves.
    const self = await within(table).findByRole('row', { name: /Meera Iyer/ });
    expect(within(self).queryByRole('button')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Name/), 'Asha Rao');
    await user.type(screen.getByLabelText(/^Email/), 'asha@vendor.example');
    await user.selectOptions(screen.getByLabelText('Role'), 'finance');
    expect(screen.getByText('Plans, invoices and payments')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(
      await screen.findByText('https://console.example/setup#secret-link'),
    ).toBeInTheDocument();
    expect(screen.getByText(/shown only now, and works for 72 hours/)).toBeInTheDocument();

    await user.click(
      within(within(table).getByRole('row', { name: /Ravi Shah/ })).getByRole('button', {
        name: 'Disable',
      }),
    );
    const confirm = screen.getByRole('group', { name: 'Disable Ravi Shah?' });
    await user.click(within(confirm).getByRole('button', { name: 'Disable' }));
    expect(
      await within(table).findByRole('row', { name: /Ravi Shah.*Disabled/ }),
    ).toBeInTheDocument();
  });

  it('resets someone’s sign-in after asking, showing the new setup link once (D101)', async () => {
    const client = fakeClient(ADMIN, (method, path) => {
      if (method === 'POST' && path === `/platform/v1/staff/${RAVI.id}/reset`) {
        return {
          staff: { ...RAVI, status: 'invited' as const },
          setupUrl: 'https://console.example/setup#a-new-link',
        };
      }
      return { items: [ADMIN, RAVI] };
    });
    renderConsole('/staff', client);
    const table = await screen.findByRole('table', { name: 'Staff' });
    const user = userEvent.setup();
    await user.click(
      within(await within(table).findByRole('row', { name: /Ravi Shah/ })).getByRole('button', {
        name: 'Reset sign-in',
      }),
    );
    const confirm = screen.getByRole('group', { name: 'Reset Ravi Shah’s sign-in?' });
    expect(within(confirm).getByText(/password and authenticator are removed/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Reset sign-in' }));
    expect(await screen.findByText('https://console.example/setup#a-new-link')).toBeInTheDocument();
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      `/platform/v1/staff/${RAVI.id}/reset`,
      expect.anything(),
    );
  });
});
