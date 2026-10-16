import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const ONE = '01a10000-0000-7000-8000-0000000000d1';
const TWO = '01a10000-0000-7000-8000-0000000000d2';
const IMPORT = '01a10000-0000-7000-8000-000000000070';

const INBOX = {
  items: [
    {
      id: ONE,
      event: 'approval.waiting',
      category: 'approvals',
      values: { name: 'Asha Rao' },
      link: '/approvals',
      readAt: null,
      createdAt: '2026-10-16T05:00:00.000Z',
    },
    {
      id: TWO,
      event: 'import.finished',
      category: 'imports',
      values: { status: 'committed', file: 'people.csv', created: 3, updated: 1 },
      link: `/imports/${IMPORT}`,
      readAt: '2026-10-16T04:00:00.000Z',
      createdAt: '2026-10-15T05:00:00.000Z',
    },
  ],
  nextCursor: null,
  unread: 1,
};

const PREFS = {
  categories: [
    { category: 'plan', muted: false, mutable: true },
    { category: 'approvals', muted: false, mutable: false },
    { category: 'review', muted: true, mutable: true },
    { category: 'targets', muted: false, mutable: true },
    { category: 'tracking', muted: false, mutable: false },
    { category: 'imports', muted: false, mutable: true },
  ],
};

function client() {
  return fakeClient(
    {
      '/v1/notifications': INBOX,
      '/v1/notification-prefs': PREFS,
      '/v1/approvals/inbox': { items: [], nextCursor: null },
    },
    {
      'POST /v1/notifications/read': () => ({ unread: 0 }),
      'PUT /v1/notification-prefs': ({ body }) => ({
        categories: PREFS.categories.map((entry) => ({
          ...entry,
          muted: (body as { muted: string[] }).muted.includes(entry.category),
        })),
      }),
    },
  );
}

describe('notifications (M16)', () => {
  it('shows the inbox in the reader’s words, with the unread count in the header', async () => {
    renderAt('/notifications', client());
    const inbox = await screen.findByRole('region', { name: 'Inbox · 1 unread' });
    expect(within(inbox).getByText('Waiting for your approval')).toBeVisible();
    expect(within(inbox).getByText('Asha Rao sent a request for you to decide.')).toBeVisible();
    expect(
      within(inbox).getByText('Your file people.csv is in: 3 added, 1 changed.'),
    ).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeVisible();
  });

  it('marks an entry read as it opens, and everything read at once', async () => {
    const fake = client();
    const router = renderAt('/notifications', fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Waiting for your approval/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/approvals'));
    expect(writesOf(fake)[0]).toEqual([
      'POST',
      '/v1/notifications/read',
      expect.anything(),
      { body: { ids: [ONE] }, idempotencyKey: expect.any(String) },
    ]);
  });

  it('saves what the person mutes; approvals and tracking stay on', async () => {
    const fake = client();
    renderAt('/notifications', fake);
    const user = userEvent.setup();
    const prefs = await screen.findByRole('region', { name: 'What I hear about' });
    expect(await within(prefs).findByRole('checkbox', { name: /Approvals/ })).toBeDisabled();
    expect(within(prefs).getByRole('checkbox', { name: 'Rejected forms' })).not.toBeChecked();
    await user.click(within(prefs).getByRole('checkbox', { name: "Today's plan" }));
    await user.click(within(prefs).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(fake)).toContainEqual([
        'PUT',
        '/v1/notification-prefs',
        expect.anything(),
        { body: { muted: ['review', 'plan'] }, idempotencyKey: expect.any(String) },
      ]),
    );
    expect(await within(prefs).findByRole('status')).toHaveTextContent('Saved.');
  });
});
