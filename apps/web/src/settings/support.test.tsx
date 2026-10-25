import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, type RequestOptions, TENANT, writesOf } from '../test-support';

const BASE = {
  tenant: { id: TENANT.id, name: TENANT.name },
  staff: { id: '01a10000-0000-7000-8000-0000000000a2', name: 'Ravi Shah' },
  emergency: false,
  approvedBy: null,
  startsAt: null,
  endsAt: null,
  closedAt: null,
  closedBy: null,
  createdAt: '2026-10-26T03:50:00.000Z',
};

const WAITING = {
  ...BASE,
  id: '01a10000-0000-7000-8000-0000000000f1',
  reason: 'Setting up designations with you',
  scope: 'write' as const,
  hours: 4,
  status: 'requested' as const,
  grantedScope: null,
};

const OPEN = {
  ...BASE,
  id: '01a10000-0000-7000-8000-0000000000f2',
  reason: 'Checking why the visit report is empty',
  scope: 'read' as const,
  hours: 2,
  status: 'active' as const,
  grantedScope: 'read' as const,
  approvedBy: { kind: 'user' as const, name: 'Anita Rao' },
  startsAt: '2026-10-26T04:00:00.000Z',
  endsAt: '2026-10-26T06:00:00.000Z',
};

const PAST = {
  ...OPEN,
  id: '01a10000-0000-7000-8000-0000000000f3',
  status: 'ended' as const,
  closedAt: '2026-10-25T05:00:00.000Z',
  closedBy: { kind: 'staff' as const, name: 'Ravi Shah' },
};

function supportClient(items: object[]) {
  let current = items;
  const settle = (id: string, change: object) => {
    current = current.map((grant) =>
      (grant as { id: string }).id === id ? { ...grant, ...change } : grant,
    );
    return current.find((grant) => (grant as { id: string }).id === id);
  };
  return fakeClient(
    {
      '/v1/support-grants': () => ({ items: current }),
      '/v1/audit': {
        items: [
          {
            id: '01a10000-0000-7000-8000-0000000000d1',
            actor: { kind: 'platform', id: BASE.staff.id },
            action: 'designation.created',
            target: { type: 'designation', id: null },
            before: null,
            after: null,
            ip: null,
            deviceId: null,
            supportGrantId: OPEN.id,
            createdAt: '2026-10-26T04:30:00.000Z',
          },
        ],
        nextCursor: null,
      },
    },
    {
      [`POST /v1/support-grants/${WAITING.id}/decision`]: ({ body }: RequestOptions) => {
        const decision = body as { approve: boolean; scope?: 'read'; hours?: number };
        return settle(
          WAITING.id,
          decision.approve
            ? {
                status: 'active',
                grantedScope: decision.scope,
                hours: decision.hours,
                endsAt: OPEN.endsAt,
              }
            : { status: 'declined', closedBy: { kind: 'user', name: 'Anita Rao' } },
        );
      },
      [`POST /v1/support-grants/${OPEN.id}/end`]: () =>
        settle(OPEN.id, { status: 'ended', closedBy: { kind: 'user', name: 'Anita Rao' } }),
    },
    ['settings.manage', 'audit.view'],
  );
}

describe('vendor support in Settings (M22, D93)', () => {
  it('approves a request narrower and shorter than asked', async () => {
    const client = supportClient([WAITING]);
    renderAt('/settings/support', client);
    const waiting = await screen.findByRole('region', { name: 'Waiting for you' });
    expect(
      within(waiting).getByText('Ravi Shah asks to see and change your organisation for 4 hours.'),
    ).toBeVisible();
    expect(within(waiting).getByText('Why: Setting up designations with you')).toBeVisible();
    const user = userEvent.setup();
    await user.selectOptions(within(waiting).getByLabelText('Access'), 'read');
    await user.selectOptions(within(waiting).getByLabelText('For'), '2');
    await user.click(within(waiting).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('region', { name: 'Open now' })).toBeVisible();
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe(`/v1/support-grants/${WAITING.id}/decision`);
    expect((options as RequestOptions).body).toEqual({ approve: true, scope: 'read', hours: 2 });
    expect(screen.getByRole('link', { name: 'Vendor support' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('declines only after asking', async () => {
    const client = supportClient([WAITING]);
    renderAt('/settings/support', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(screen.getByText('Decline Ravi Shah’s request? They can ask again.')).toBeVisible();
    expect(writesOf(client)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    const earlier = await screen.findByRole('table', { name: 'Earlier' });
    expect(within(earlier).getByRole('row', { name: /Ravi Shah/ })).toHaveTextContent('Declined');
  });

  it('shows what support did under open access, and ends it after asking', async () => {
    const client = supportClient([OPEN, PAST]);
    renderAt('/settings/support', client);
    const open = await screen.findByRole('region', { name: 'Open now' });
    expect(within(open).getByText('Approved by Anita Rao')).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(open).getByText('What vendor support did'));
    expect(await within(open).findByText('designation.created')).toBeVisible();
    const earlier = screen.getByRole('table', { name: 'Earlier' });
    expect(within(earlier).getByRole('row', { name: /Ravi Shah/ })).toHaveTextContent('Ended');

    await user.click(within(open).getByRole('button', { name: 'End access' }));
    expect(
      screen.getByText('End Ravi Shah’s access now? Their session ends at once.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'End access' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Open now' })).not.toBeInTheDocument(),
    );
    expect(writesOf(client).map(([, path]) => path)).toEqual([`/v1/support-grants/${OPEN.id}/end`]);
  });

  it('tells vendor support, on every screen, that they are in and until when', async () => {
    const client = supportClient([]);
    client.me.mockResolvedValue({
      ...(await client.me()),
      name: 'Ravi Shah',
      role: 'vendor_support',
      support: {
        grantId: OPEN.id,
        staffName: 'Ravi Shah',
        scope: 'read',
        endsAt: OPEN.endsAt,
      },
    } as never);
    renderAt('/settings/support', client);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(
      /You are in Sunrise Traders as vendor support, to see only, until 26 Oct 2026/,
    );
    const user = userEvent.setup();
    await user.click(within(banner).getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalled();
  });
});
