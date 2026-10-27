import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
