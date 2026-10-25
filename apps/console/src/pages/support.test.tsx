import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, billingAnswer, fakeClient, OPEN, renderConsole, TENANT } from '../test-support';
import { portal } from './support';

const RAVI = {
  ...ADMIN,
  id: '01a10000-0000-7000-8000-0000000000a2',
  email: 'ravi@vendor.example',
  name: 'Ravi Shah',
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

const GRANT = {
  id: '01a10000-0000-7000-8000-0000000000f1',
  tenant: { id: TENANT.id, name: TENANT.name },
  staff: { id: RAVI.id, name: RAVI.name },
  reason: 'Checking why the visit report is empty',
  scope: 'read' as const,
  hours: 4,
  emergency: false,
  status: 'active' as const,
  grantedScope: 'read' as const,
  approvedBy: { kind: 'user' as const, name: 'Anita Rao' },
  startsAt: '2026-10-26T04:00:00.000Z',
  endsAt: '2026-10-26T08:00:00.000Z',
  closedAt: null,
  closedBy: null,
  createdAt: '2026-10-26T03:50:00.000Z',
};

const EMERGENCY = {
  ...GRANT,
  id: '01a10000-0000-7000-8000-0000000000f2',
  reason: 'Orders are failing for everyone',
  hours: 2,
  emergency: true,
  status: 'requested' as const,
  grantedScope: null,
  approvedBy: null,
  startsAt: null,
  endsAt: null,
};

describe('support access in the console (M22, D93)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the portal under one’s own open grant, in a new tab', async () => {
    const open = vi.spyOn(portal, 'open').mockImplementation(async (link) => {
      await link();
    });
    const client = fakeClient(RAVI, (method, path) => {
      if (method === 'POST' && path.endsWith('/enter')) {
        return { url: 'http://127.0.0.1:5173/auth/v1/support/enter?code=one-time' };
      }
      return { items: [GRANT] };
    });
    renderConsole('/support', client);
    const table = await screen.findByRole('table', { name: 'Support access' });
    const row = within(table).getByRole('row', { name: /Sunrise Agro/ });
    expect(row).toHaveTextContent('See only');
    expect(row).toHaveTextContent('Open');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Open the portal' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      `/platform/v1/support-grants/${GRANT.id}/enter`,
      expect.anything(),
    );
    // Only theirs: support staff can't approve emergencies.
    expect(within(row).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('lets a vendor admin approve another’s emergency request, after asking', async () => {
    let grants = [EMERGENCY];
    const client = fakeClient(ADMIN, (method, path) => {
      if (method === 'POST' && path.endsWith('/approve')) {
        grants = [{ ...EMERGENCY, status: 'active', grantedScope: 'read' } as never];
        return grants[0];
      }
      return { items: grants };
    });
    renderConsole('/support', client);
    const table = await screen.findByRole('table', { name: 'Support access' });
    const row = within(table).getByRole('row', { name: /Ravi Shah/ });
    expect(row).toHaveTextContent('Emergency');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(
      screen.getByText(
        'Approve Ravi Shah’s emergency access to Sunrise Agro, to see only, for 2 hours? Its admins are told at once.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await within(screen.getByRole('table', { name: 'Support access' })).findByText('Open'),
    ).toBeVisible();
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      `/platform/v1/support-grants/${EMERGENCY.id}/approve`,
      expect.anything(),
    );
  });

  it('asks for access from the tenant’s page, reading only and briefly in an emergency', async () => {
    const client = fakeClient(RAVI, (method, path, body) => {
      if (method === 'POST' && path === '/platform/v1/support-grants')
        return { ...EMERGENCY, ...(body as object) };
      if (path.startsWith('/platform/v1/support-grants')) return { items: [] };
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) return { items: [] };
      return TENANT;
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(/^Why/, {}, { timeout: 5000 }),
      'Orders are failing for everyone',
    );
    await user.click(screen.getByRole('checkbox', { name: /Emergency/ }));
    expect(screen.getByLabelText('Access')).toBeDisabled();
    // Two hours at most.
    expect(
      within(screen.getByLabelText('Hours'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1 hour', '2 hours']);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Asked. A second vendor admin must approve it.')).toBeVisible();
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/platform/v1/support-grants',
      expect.anything(),
      {
        tenantId: TENANT.id,
        reason: 'Orders are failing for everyone',
        scope: 'read',
        hours: 2,
        emergency: true,
      },
    );
  });
});
