import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TenantPermission } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt } from '../test-support';

const NOTIFICATIONS = { items: [], nextCursor: null, unread: 0 };

describe('the frame (decision D104)', () => {
  it('counts what waits beside the rail’s entries, and says so to screen readers', async () => {
    const client = fakeClient(
      {
        '/v1/notifications': NOTIFICATIONS,
        '/v1/dashboard/waiting': { reviews: 14, approvals: 0 },
      },
      {},
      ['submission.review', 'approval.act'],
    );
    renderAt('/notifications', client);
    const review = await screen.findByRole('link', { name: 'Review, 14 waiting' });
    expect(within(review).getByText('14')).toHaveClass('ks-rail-count');
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
  });

  it('shows no counts to someone who can act on nothing', async () => {
    renderAt(
      '/notifications',
      fakeClient({
        '/v1/notifications': NOTIFICATIONS,
        '/v1/dashboard/waiting': { reviews: null, approvals: null },
      }),
    );
    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  it('keeps sign-in security, the look and signing out behind the person’s avatar', async () => {
    const client = fakeClient({ '/v1/notifications': NOTIFICATIONS });
    renderAt('/notifications', client);
    const user = userEvent.setup();
    const menu = await screen.findByRole('button', { name: 'Your profile and settings' });
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    await user.click(menu);
    expect(screen.getByRole('link', { name: 'Sign-in security' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeVisible();
    expect(screen.getByText('Anita Rao', { selector: '.ks-title' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalled();
  });

  it('keeps sign-out within reach when who the person is can’t be read', async () => {
    const client = fakeClient({ '/v1/notifications': NOTIFICATIONS });
    client.me.mockRejectedValue(new Error('offline'));
    renderAt('/notifications', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Your profile and settings' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalled();
  });

  it('switches language in one tap, and draws the organisation’s initials without a logo', async () => {
    renderAt('/notifications', fakeClient({ '/v1/notifications': NOTIFICATIONS }));
    const user = userEvent.setup();
    expect(await screen.findByText('ST', { selector: '.ks-appbar-org .ks-ico' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Switch to हिन्दी/ }));
    expect(await screen.findByRole('button', { name: /English चुनें/ })).toHaveAttribute(
      'lang',
      'en',
    );
  });

  it('shows Settings to whoever holds any settings page’s permission', async () => {
    // Each of these opens one settings page and nothing else in the rail.
    const alone: TenantPermission[] = [
      'audit.view',
      'workflow.manage',
      'calendar.manage',
      'leave_type.manage',
      'expense_policy.manage',
      'dashboard.manage',
      'billing.manage',
      'api_client.manage',
      'webhook.manage',
      'erp.manage',
      'designation.manage',
    ];
    for (const permission of alone) {
      const client = fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, [permission]);
      renderAt('/notifications', client);
      expect(await screen.findByRole('link', { name: 'Settings' }), permission).toBeVisible();
      cleanup();
    }
  });

  it('shows no Settings without a settings page’s permission', async () => {
    renderAt(
      '/notifications',
      fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['user.view']),
    );
    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('takes Settings to the first page the person may open', async () => {
    const client = fakeClient({ '/v1/audit': { items: [], nextCursor: null } }, {}, ['audit.view']);
    const router = renderAt('/settings', client);
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/security'));
  });
});

describe('the read-only banner (decision D140)', () => {
  const standing = (client: ReturnType<typeof fakeClient>, change: object) => {
    const me = client.me.getMockImplementation()!;
    client.me.mockImplementation(async () => ({ ...(await me()), ...change }));
    return client;
  };

  it('tells everyone the organisation only reads, and asks them to see an admin', async () => {
    const client = standing(fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['user.view']), {
      readOnly: true,
    });
    renderAt('/notifications', client);
    expect(await screen.findByText(/can only read for now/)).toHaveTextContent(
      'Ask an admin about billing.',
    );
    expect(screen.queryByRole('link', { name: 'Open Billing' })).toBeNull();
    // Nobody but a billing admin reads billing.
    expect(client.request.mock.calls.map(([, path]) => path)).not.toContain('/v1/billing');
  });

  it('takes a billing admin to Billing while read only', async () => {
    const client = standing(
      fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['billing.manage']),
      { readOnly: true },
    );
    renderAt('/notifications', client);
    expect(await screen.findByText(/Billing says why and what to do/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Billing' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  it('warns a billing admin during grace of the day it will read only', async () => {
    const dunning = {
      overdueSince: '2026-11-01',
      stage: 'grace',
      readOnlyOn: '2026-11-08',
      suspendOn: '2026-11-22',
      outstanding: '11800.00',
    };
    renderAt(
      '/notifications',
      fakeClient({ '/v1/notifications': NOTIFICATIONS, '/v1/billing': { dunning } }, {}, [
        'billing.manage',
      ]),
    );
    expect(await screen.findByText(/A payment is overdue/)).toHaveTextContent(/8 Nov 2026/);
    expect(screen.getByRole('link', { name: 'Open Billing' })).toBeVisible();
  });

  it('says nothing of grace to someone without billing', async () => {
    const client = fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['user.view']);
    renderAt('/notifications', client);
    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText(/payment is overdue|can only read/)).toBeNull();
  });

  it('tells everyone while the organisation is moving', async () => {
    const client = standing(
      fakeClient({ '/v1/notifications': NOTIFICATIONS }, {}, ['billing.manage']),
      { moving: true },
    );
    renderAt('/notifications', client);
    expect(await screen.findByText(/being moved to a new server/)).toBeVisible();
    expect(screen.queryByText(/can only read/)).toBeNull();
  });
});
