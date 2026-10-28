import { ApiError } from '@thelamp/api-client';
import { formatMonth } from '@thelamp/i18n';
import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const MANAGER = '01a10000-0000-7000-8000-000000000003';
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const ANITA = '01a10000-0000-7000-8000-000000000005';
const NORTH = '01a10000-0000-7000-8000-000000000010';
const PERIOD = todayIn('Asia/Kolkata').slice(0, 7);
const MONTH = formatMonth(PERIOD, { locale: 'en' });

function dates() {
  const [year, month] = PERIOD.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${PERIOD}-${String(i + 1).padStart(2, '0')}`);
}

/** A month of days: present, then a half day, leave, an absence and a weekly off. */
function days(pattern: string[]) {
  return dates().map((date, index) => ({ date, status: pattern[index] ?? 'future' }));
}

function approval(id: string, type: 'leave' | 'regularisation', title: string, at: string) {
  return {
    id,
    requestType: type,
    requestId: id,
    subject: { title, accountId: null },
    requester: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
    status: 'pending',
    version: 1,
    steps: [
      {
        index: 0,
        approvers: [{ id: MANAGER, code: 'SUN-003', name: 'Priya Nair' }],
        status: 'pending',
        actedBy: null,
        actedAt: null,
        note: null,
        skipReason: null,
        escalated: false,
        fallback: false,
      },
    ],
    cancellable: true,
    bulk: true,
    page: null,
    createdAt: at,
    closedAt: null,
  };
}

const COUNTS = { leave: 1, regularisation: 1 };

function fakeClient(modulesOff: string[] = []) {
  const pages: Record<string, unknown> = {
    '/v1/attendance/register': {
      period: PERIOD,
      items: [
        {
          user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
          days: days(['present', 'half_day', 'paid_leave', 'absent', 'weekly_off']),
          present: 1.5,
        },
        {
          user: { id: ANITA, code: 'SUN-005', name: 'Anita Rao' },
          days: days(['present', 'present']),
          present: 2,
        },
      ],
      nextCursor: null,
    },
    '/v1/approvals/inbox?requestType=leave': {
      items: [
        approval(
          '01a10000-0000-7000-8000-0000000000a1',
          'leave',
          '9–10 Nov',
          '2026-10-02T07:00:00.000Z',
        ),
      ],
      nextCursor: null,
      counts: COUNTS,
    },
    '/v1/approvals/inbox?requestType=regularisation': {
      items: [
        approval(
          '01a10000-0000-7000-8000-0000000000a2',
          'regularisation',
          '14 Oct',
          '2026-10-01T07:00:00.000Z',
        ),
      ],
      nextCursor: null,
      counts: COUNTS,
    },
    '/v1/territories': {
      items: [
        {
          id: NORTH,
          code: 'N-DEL',
          name: 'Delhi',
          parentId: null,
          levelKey: null,
          active: true,
          path: [],
        },
      ],
    },
    '/v1/leave-requests': {
      items: [
        {
          id: '01a10000-0000-7000-8000-0000000000e1',
          userId: ANITA,
          leaveType: 'casual',
          startDate: `${PERIOD}-09`,
          endDate: `${PERIOD}-10`,
          halfDay: false,
          days: 2,
          reason: null,
          attachmentId: null,
          state: 'approved',
          approval: null,
          createdAt: '2026-10-01T07:00:00.000Z',
          decidedAt: null,
        },
      ],
      people: [{ id: ANITA, code: 'SUN-005', name: 'Anita Rao' }],
    },
    '/v1/leave-types': {
      items: [
        {
          key: 'casual',
          name: { en: 'Casual', hi: 'आकस्मिक' },
          paid: true,
          annualQuota: 12,
          quotaYear: 'calendar',
          halfDayAllowed: true,
          active: true,
        },
      ],
    },
  };
  const request = vi.fn(async (method: string, path: string) => {
    const bare = path.split('?')[0]!;
    if (method === 'GET') {
      if (path in pages) return pages[path];
      if (bare in pages) return pages[bare];
    }
    throw new ApiError(404, 'NOT_FOUND', `Nothing at ${method} ${path}`);
  });
  return {
    request,
    session: { tenant: TENANT, accessToken: 'a1', accessTokenExpiresAt: '' },
    restore: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    me: vi.fn(async () => ({
      userId: MANAGER,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-003',
      name: 'Priya Nair',
      designation: 'manager',
      role: 'manager',
      scope: 'team',
      permissions: [],
      deviceId: null,
    })),
    config: vi.fn(async () => ({
      status: 'fresh',
      etag: '"1-role"',
      bundle: {
        version: 1,
        settings: { ...SETTING_DEFAULTS, modulesOff },
        terminology: {},
        designations: [],
        access: {
          role: 'manager',
          scope: 'team',
          permissions: ['user.view', 'approval.act', 'report.view'],
        },
      },
    })),
  };
}

function renderAt(path: string, client: ReturnType<typeof fakeClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ client: client as unknown as WebClient, queryClient });
  const memory = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={memory} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('attendance (decision D104)', () => {
  it('shows everyone by day as letters with their present total, the key, and what waits', async () => {
    renderAt('/attendance', fakeClient());
    expect(
      await screen.findByRole('heading', { level: 1, name: `Attendance · ${MONTH}` }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', {
      name: `Attendance in ${MONTH}, a person a row and a day a column`,
    });
    const rahul = within(table).getByRole('row', { name: /Rahul Verma/ });
    const cells = within(rahul).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Present');
    expect(cells[1]).toHaveTextContent('Half day');
    expect(cells[2]).toHaveTextContent('Leave');
    expect(cells[3]).toHaveTextContent('Absent, to fix');
    expect(cells[4]).toHaveTextContent('Off or holiday');
    // A day still to come shows nothing.
    expect(cells[5]).toBeEmptyDOMElement();
    expect(cells.at(-1)).toHaveTextContent('1.5');
    expect(within(table).getByRole('row', { name: /Anita Rao/ })).toBeInTheDocument();

    const key = screen.getByRole('list', { name: 'What the letters mean' });
    expect(within(key).getAllByRole('listitem')).toHaveLength(5);

    const waiting = screen.getByRole('region', { name: 'Waiting for a decision · 2' });
    const items = await within(waiting).findAllByRole('link');
    expect(items[0]).toHaveTextContent('Rahul Verma · 14 Oct');
    expect(items[0]).toHaveTextContent('Fix');
    expect(items[1]).toHaveTextContent('Leave');
    expect(items[1]).toHaveTextContent('Priya Nair');
  });

  it('asks again for a territory, and lists the team’s leave in the month', async () => {
    const client = fakeClient();
    renderAt('/attendance', client);
    const user = userEvent.setup();
    await screen.findByRole('table', { name: /a person a row/ });
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Territory' }),
      'Delhi (N-DEL)',
    );
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        `/v1/attendance/register?period=${PERIOD}&territoryId=${NORTH}`,
        expect.anything(),
      ),
    );

    await user.click(screen.getByRole('tab', { name: 'Leave' }));
    const leave = await screen.findByRole('table', { name: /Leave taking in a day of/ });
    const row = within(leave).getByRole('row', { name: /Anita Rao/ });
    expect(row).toHaveTextContent('Casual');
    expect(row).toHaveTextContent('Approved');
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      `/v1/leave-requests?team=true&period=${PERIOD}`,
      expect.anything(),
    );
  });

  it('has a place in the rail only while leave and attendance are on', async () => {
    renderAt('/', fakeClient());
    const rail = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(await within(rail).findByRole('link', { name: 'Attendance' })).toBeInTheDocument();
  });

  it('leaves the rail without it when the module is off', async () => {
    renderAt('/', fakeClient(['leave_attendance']));
    const rail = await screen.findByRole('navigation', { name: 'Main menu' });
    await within(rail).findByRole('link', { name: 'People' });
    expect(within(rail).queryByRole('link', { name: 'Attendance' })).toBeNull();
  });
});
