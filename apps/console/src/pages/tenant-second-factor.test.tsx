import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, billingAnswer, fakeClient, OPEN, renderConsole, TENANT } from '../test-support';

const RESETS = `/platform/v1/tenants/${TENANT.id}/second-factor-resets`;

/** A tenant page whose resets `reset` answers. */
function page(reset: (body: unknown) => unknown, staff = ADMIN) {
  return fakeClient(staff, (method, path, body) => {
    if (method === 'POST' && path === RESETS) return reset(body);
    const billing = billingAnswer(path);
    if (billing !== undefined) return billing;
    if (path.endsWith('/entitlements')) return OPEN;
    if (path.includes('/usage')) return { items: [] };
    if (path === '/platform/v1/plans') return { items: [] };
    if (path.endsWith('/data-exports')) return { items: [] };
    return TENANT;
  });
}

async function card() {
  const heading = await screen.findByRole('heading', { name: 'Reset an authenticator' });
  return heading.closest('form')!;
}

const posts = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls.filter(([method]) => method === 'POST');

describe('resetting a tenant member’s authenticator in the console (D91)', () => {
  it('says the tenant hears of it, checks the number first, and sends it with the reason', async () => {
    const client = page(() => ({ removed: true }));
    renderConsole(`/tenants/${TENANT.id}`, client);
    const form = await card();
    expect(form).toHaveTextContent(
      'The organisation’s admins are told, and it shows in its audit log.',
    );
    const user = userEvent.setup();
    const reset = within(form).getByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();

    await user.type(within(form).getByLabelText(/Their mobile number/), '12345');
    await user.type(within(form).getByLabelText(/How you confirmed/), 'Called back');
    await user.click(reset);
    expect(posts(client)).toEqual([]);

    await user.clear(within(form).getByLabelText(/Their mobile number/));
    await user.type(within(form).getByLabelText(/Their mobile number/), '9876543210');
    await user.click(reset);
    expect(
      await within(form).findByText(
        'Removed. They set up a new authenticator at their next sign-in.',
      ),
    ).toBeVisible();
    expect(posts(client)).toEqual([
      ['POST', RESETS, expect.anything(), { phone: '9876543210', reason: 'Called back' }],
    ]);
  });

  it('says when they had none, and shows a number nobody in the tenant has', async () => {
    let removed = false;
    const client = page(() => {
      if (!removed) {
        removed = true;
        return { removed: false };
      }
      return new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
        { path: 'phone', issue: 'Nobody in this tenant has this number' },
      ]);
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    const form = await card();
    const user = userEvent.setup();
    const send = async () => {
      await user.type(within(form).getByLabelText(/Their mobile number/), '9876543210');
      await user.type(within(form).getByLabelText(/How you confirmed/), 'Called back');
      await user.click(within(form).getByRole('button', { name: 'Reset' }));
    };
    await send();
    expect(
      await within(form).findByText('They had no authenticator; their sessions have ended.'),
    ).toBeVisible();
    await send();
    expect(await within(form).findByText('Nobody in this tenant has this number')).toBeVisible();
  });

  it('is not offered to staff who may not ask for support', async () => {
    const viewer = { ...ADMIN, permissions: ['platform.tenant.manage' as const] };
    const client = page(() => ({ removed: true }), viewer);
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(await screen.findByRole('heading', { name: TENANT.name })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Reset an authenticator' })).toBeNull(),
    );
  });
});
