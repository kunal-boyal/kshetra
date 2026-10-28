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
const SHOP = '01a10000-0000-7000-8000-000000000080';
const DEPOT = '01a10000-0000-7000-8000-000000000081';
const PERIOD = todayIn('Asia/Kolkata').slice(0, 7);
const MONTH = formatMonth(PERIOD, { locale: 'en' });
const APPROVAL = '01a10000-0000-7000-8000-0000000000d1';
const iso = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

function account(id: string, name: string) {
  return {
    id,
    type: 'customer',
    code: `C-${id.slice(-2)}`,
    name,
    territory: { id: '01a10000-0000-7000-8000-000000000010', code: 'N-DEL', name: 'Delhi' },
    parent: null,
    address: {},
    location: null,
    geofenceRadiusM: null,
    locationStatus: 'unverified',
    status: 'active',
    segments: [],
    custom: {},
    slots: [],
    primarySlot: null,
    missingSlots: [],
    createdAt: '2026-10-01T07:00:00.000Z',
    updatedAt: '2026-10-01T07:00:00.000Z',
  };
}

function item(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: RAHUL,
    account: { id: SHOP, code: 'C-80', name: 'Sharma Stores' },
    date: `${PERIOD}-20`,
    purpose: null,
    note: null,
    status,
    source: 'route',
    routeId: '01a10000-0000-7000-8000-0000000000b1',
    visitId: null,
    ...overrides,
  };
}

const PLANNED = '01a10000-0000-7000-8000-0000000000c1';

type Answer = (body: unknown) => unknown;

function fakeClient(writes: Record<string, Answer> = {}, approval: unknown = null) {
  const pages: Record<string, unknown> = {
    [`/v1/users/${RAHUL}`]: {
      id: RAHUL,
      code: 'SUN-004',
      name: 'Rahul Verma',
      phone: null,
      email: null,
      designation: 'executive',
      role: 'field_user',
      managerId: MANAGER,
      manager: { id: MANAGER, code: 'SUN-003', name: 'Priya Nair' },
      joiningDate: '2026-04-01',
      exitDate: null,
      status: 'active',
      territories: [],
      custom: {},
      createdAt: '2026-10-06T07:00:00.000Z',
      updatedAt: '2026-10-06T07:00:00.000Z',
      device: null,
    },
    '/v1/plan-items': {
      items: [
        item(PLANNED, 'planned'),
        item('01a10000-0000-7000-8000-0000000000c2', 'completed', {
          source: 'adhoc',
          routeId: null,
          purpose: 'Collect payment',
          date: `${PERIOD}-02`,
        }),
      ],
      approval,
    },
    '/v1/routes': {
      items: [
        {
          id: '01a10000-0000-7000-8000-0000000000b1',
          userId: RAHUL,
          name: 'Market road',
          recurrence: { kind: 'weekdays', days: [1, 4] },
          accounts: [
            { id: SHOP, code: 'C-80', name: 'Sharma Stores' },
            { id: DEPOT, code: 'C-81', name: 'Verma Depot' },
          ],
          active: true,
        },
      ],
    },
    '/v1/calendars': {
      items: [
        {
          key: 'standard',
          name: { en: 'Standard', hi: 'सामान्य' },
          weeklyOffs: [7],
          default: true,
          holidays: [
            { date: `${PERIOD}-16`, name: 'Founders Day', optional: false },
            { date: `${PERIOD}-17`, name: 'Local fair', optional: true },
          ],
        },
      ],
    },
    '/v1/leave-requests': {
      items: [
        {
          id: '01a10000-0000-7000-8000-0000000000e1',
          userId: RAHUL,
          leaveType: 'casual',
          startDate: `${PERIOD}-09`,
          endDate: `${PERIOD}-09`,
          halfDay: false,
          days: 1,
          reason: null,
          attachmentId: null,
          state: 'pending',
          approval: null,
          createdAt: '2026-10-01T07:00:00.000Z',
          decidedAt: null,
        },
      ],
      people: [{ id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' }],
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
    [`/v1/approvals/${APPROVAL}`]: {
      id: APPROVAL,
      requestType: 'journey_plan',
      requestId: '01a10000-0000-7000-8000-0000000000d2',
      subject: { title: 'Rahul Verma', accountId: null, detail: null },
      requester: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
      status: 'pending',
      version: 3,
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
      createdAt: '2026-10-01T07:00:00.000Z',
      closedAt: null,
    },
    '/v1/targets': {
      period: PERIOD,
      metrics: [
        {
          key: 'visits',
          name: { en: { one: 'Visit', other: 'Visits' }, hi: { one: 'विज़िट', other: 'विज़िट' } },
          unit: 'count',
          direction: 'higher_is_better',
          targetable: true,
        },
      ],
      sets: [
        {
          user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
          period: PERIOD,
          status: 'locked',
          values: { visits: '180' },
          lockedAt: '2026-10-20T07:00:00.000Z',
          lockedBy: { id: MANAGER, name: 'Priya Nair' },
          version: 2,
        },
      ],
      own: {
        user: { id: MANAGER, code: 'SUN-003', name: 'Priya Nair' },
        period: PERIOD,
        status: 'none',
        values: {},
        lockedAt: null,
        lockedBy: null,
        version: 0,
      },
      totals: { visits: '180' },
    },
    '/v1/accounts': {
      items: [
        { ...account(SHOP, 'Sharma Stores'), location: { lat: 28.6315, lng: 77.2167 } },
        account(DEPOT, 'Verma Depot'),
      ],
      nextCursor: null,
    },
  };
  const request = vi.fn(
    async (
      method: string,
      path: string,
      _schema: unknown,
      options: { body?: unknown; idempotencyKey?: string } = {},
    ) => {
      const bare = path.split('?')[0]!;
      if (method === 'GET') {
        if (path in pages) return pages[path];
        if (bare in pages) return pages[bare];
        throw new ApiError(404, 'NOT_FOUND', `Nothing at ${path}`);
      }
      const answer = writes[`${method} ${bare}`];
      if (!answer) throw new ApiError(404, 'NOT_FOUND', `Nothing at ${method} ${path}`);
      return answer(options.body);
    },
  );
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
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        access: {
          role: 'manager',
          scope: 'team',
          permissions: [
            'user.view',
            'account.view',
            'plan_item.manage',
            'route.manage',
            'target.view',
            'target.edit',
            'target.unlock',
          ],
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

const writes = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls.filter(([method]) => method !== 'GET');

describe("a person's plan (M8)", () => {
  it('shows the month by date with each visit’s status, and the routes', async () => {
    renderAt(`/people/${RAHUL}/plan`, fakeClient());
    expect(
      await screen.findByRole('heading', { level: 1, name: `Rahul Verma · ${MONTH}` }),
    ).toBeInTheDocument();
    // Without plan approval in the tenant, nothing waits for a decision.
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    const table = await screen.findByRole('table', { name: 'Planned visits this month, by date' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Sharma Stores');
    expect(rows[0]).toHaveTextContent('Planned');
    expect(rows[0]).toHaveTextContent('On the route');
    expect(rows[1]).toHaveTextContent('Collect payment');
    expect(rows[1]).toHaveTextContent('Completed');
    expect(within(rows[1]!).queryByRole('button', { name: 'Cancel visit' })).toBeNull();
    const routes = screen.getByRole('list', { name: 'Routes' });
    expect(routes).toHaveTextContent('Every Monday, Thursday');
    expect(routes).toHaveTextContent('Sharma Stores → Verma Depot');
  });

  it('plans from routes, plans a visit by hand, and cancels one after asking', async () => {
    const client = fakeClient({
      'POST /v1/plans/generate': () => ({ created: 9, skippedAccounts: [] }),
      'POST /v1/plan-items': (body) => ({ ...item('x', 'planned'), ...(body as object) }),
      [`POST /v1/plan-items/${PLANNED}/cancel`]: () => item(PLANNED, 'cancelled'),
    });
    renderAt(`/people/${RAHUL}/plan`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Plan from routes' }));
    expect(await screen.findByText('9 visits planned from routes.')).toBeInTheDocument();

    const add = screen.getByRole('region', { name: 'Plan a visit' });
    await user.selectOptions(
      await within(add).findByRole('combobox', { name: /Account/ }),
      'Verma Depot (C-81)',
    );
    await user.type(within(add).getByRole('textbox', { name: 'Purpose' }), 'New stock');
    await user.click(within(add).getByRole('button', { name: 'Plan a visit' }));
    expect(await within(add).findByText('Visit planned.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Cancel visit' })[0]!);
    const question = screen.getByRole('group', { name: /Cancel the visit to Sharma Stores/ });
    await user.click(within(question).getByRole('button', { name: 'Cancel visit' }));
    expect(await screen.findByText('Visit cancelled.')).toBeInTheDocument();

    expect(writes(client)).toEqual([
      [
        'POST',
        '/v1/plans/generate',
        expect.anything(),
        { body: { userId: RAHUL, period: PERIOD }, idempotencyKey: expect.any(String) },
      ],
      [
        'POST',
        '/v1/plan-items',
        expect.anything(),
        {
          body: {
            id: expect.any(String),
            userId: RAHUL,
            accountId: DEPOT,
            date: todayIn('Asia/Kolkata'),
            purpose: 'New stock',
          },
        },
      ],
      [
        'POST',
        `/v1/plan-items/${PLANNED}/cancel`,
        expect.anything(),
        { idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('adds a route of places in order, on chosen weekdays', async () => {
    const client = fakeClient({
      'POST /v1/routes': (body) => ({ ...(body as object), accounts: [], active: true }),
    });
    renderAt(`/people/${RAHUL}/plan`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a route' }));
    const form = screen.getByRole('form', { name: 'Add a route' });
    await user.type(within(form).getByRole('textbox', { name: /Route name/ }), 'Station road');
    await user.click(within(form).getByRole('checkbox', { name: 'Wednesday' }));
    const add = within(form).getByRole('combobox', { name: /to the route/ });
    await user.selectOptions(add, 'Verma Depot (C-81)');
    await user.selectOptions(add, 'Sharma Stores (C-80)');
    expect(within(form).getByRole('list', { name: 'Stops, first to last' })).toHaveTextContent(
      /1\. Verma Depot.*2\. Sharma Stores/,
    );
    await user.click(within(form).getByRole('button', { name: 'Save route' }));
    await waitFor(() =>
      expect(writes(client)).toEqual([
        [
          'POST',
          '/v1/routes',
          expect.anything(),
          {
            body: {
              id: expect.any(String),
              userId: RAHUL,
              name: 'Station road',
              recurrence: { kind: 'weekdays', days: [1, 3] },
              accountIds: [DEPOT, SHOP],
            },
          },
        ],
      ]),
    );
  });

  it('reorders a route’s stops, and maps the ones with a known place', async () => {
    renderAt(`/people/${RAHUL}/plan`, fakeClient());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a route' }));
    const form = screen.getByRole('form', { name: 'Add a route' });
    const add = within(form).getByRole('combobox', { name: /to the route/ });
    await user.selectOptions(add, 'Verma Depot (C-81)');
    await user.selectOptions(add, 'Sharma Stores (C-80)');
    expect(within(form).getByRole('button', { name: 'Move Verma Depot up' })).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Move Sharma Stores up' }));
    expect(within(form).getByRole('list', { name: 'Stops, first to last' })).toHaveTextContent(
      /1\. Sharma Stores.*2\. Verma Depot/,
    );
    // Without a Maps key the map says so; it is drawn only once a stop has a known place.
    expect(within(form).getByRole('img', { name: 'Map of the route, stop by stop' })).toBeVisible();
  });

  it('sends a month for approval where the tenant asks for it', async () => {
    const client = fakeClient(
      { 'POST /v1/plans/submit': () => ({ status: 'submitted', approvalId: null }) },
      { status: 'draft', approvalId: null },
    );
    renderAt(`/people/${RAHUL}/plan`, client);
    const user = userEvent.setup();
    expect(await screen.findByText('Not sent for approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
  });

  it('lays the month out from Monday, with weekly offs, holidays, leave and the day’s visits', async () => {
    renderAt(`/people/${RAHUL}/plan`, fakeClient());
    const calendar = await screen.findByRole('table', {
      name: `Planned visits in ${MONTH}, by day`,
    });
    const weeks = within(calendar).getAllByRole('row').slice(1);
    const first = within(weeks[0]!).getAllByRole('cell');
    // Blank days before the 1st, which falls on its weekday.
    for (const cell of first.slice(0, iso(`${PERIOD}-01`) - 1)) expect(cell).toBeEmptyDOMElement();
    expect(first[iso(`${PERIOD}-01`) - 1]).toHaveTextContent(/^1/);
    // A day's cell, by the date it starts with.
    const day = (date: number) =>
      within(calendar)
        .getAllByRole('cell')
        .find((cell) => cell.querySelector('span')?.textContent === String(date))!;
    expect(await within(calendar).findByText('Leave asked')).toBeInTheDocument();
    expect(await within(calendar).findByText('Market road')).toBeInTheDocument();
    expect(day(9)).toHaveTextContent('Leave asked');
    expect(day(9)).toHaveTextContent('Casual');
    expect(day(16)).toHaveTextContent('Founders Day');
    // An optional holiday takes no day off.
    expect(day(17)).not.toHaveTextContent('Local fair');
    expect(day(20)).toHaveTextContent('Market road');
    expect(day(20)).toHaveTextContent('1 stop');
    expect(day(2)).toHaveTextContent('Sharma Stores');
    const sunday = [...Array(28).keys()]
      .map((index) => index + 1)
      .find(
        (date) =>
          iso(`${PERIOD}-${String(date).padStart(2, '0')}`) === 7 && ![9, 16].includes(date),
      )!;
    expect(day(sunday)).toHaveTextContent('Weekly off');
  });

  it('approves a plan, or sends it back with a note, while it waits for the viewer', async () => {
    const client = fakeClient(
      {
        [`POST /v1/approvals/${APPROVAL}/decision`]: () => ({}),
      },
      { status: 'submitted', approvalId: APPROVAL },
    );
    renderAt(`/people/${RAHUL}/plan`, client);
    const user = userEvent.setup();
    expect(await screen.findByText('Waiting for your approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    const note = screen.getByRole('textbox', { name: /Why are you sending it back/ });
    await user.type(note, 'Add the market days');
    await user.click(screen.getAllByRole('button', { name: 'Send back' }).at(-1)!);
    expect(await screen.findByText('Plan sent back.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve plan' }));
    expect(await screen.findByText('Plan approved.')).toBeInTheDocument();
    expect(writes(client)).toEqual([
      [
        'POST',
        `/v1/approvals/${APPROVAL}/decision`,
        expect.anything(),
        {
          body: { decision: 'reject', version: 3, note: 'Add the market days' },
          idempotencyKey: expect.any(String),
        },
      ],
      [
        'POST',
        `/v1/approvals/${APPROVAL}/decision`,
        expect.anything(),
        { body: { decision: 'approve', version: 3 }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('shows the month’s targets beside the plan, unlocks them with a reason and copies them on', async () => {
    const client = fakeClient({
      'POST /v1/targets/unlock': () => ({
        user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
        period: PERIOD,
        status: 'draft',
        values: { visits: '180' },
        lockedAt: null,
        lockedBy: null,
        version: 3,
      }),
      'POST /v1/targets/copy': () => ({ copied: [RAHUL], skipped: [] }),
    });
    renderAt(`/people/${RAHUL}/plan`, client);
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: `${MONTH} targets` });
    expect(within(panel).getByText(/^Locked/)).toBeInTheDocument();
    expect(await within(panel).findByRole('row', { name: /Visits/ })).toHaveTextContent('180');
    expect(panel).toHaveTextContent('Set by Priya Nair.');
    await user.click(within(panel).getByRole('button', { name: 'Unlock' }));
    const unlock = within(panel).getAllByRole('button', { name: 'Unlock' }).at(-1)!;
    expect(unlock).toBeDisabled();
    await user.type(
      within(panel).getByRole('textbox', { name: /Reason/ }),
      'Beat changed mid-month',
    );
    await user.click(unlock);
    expect(await within(panel).findByText('Targets of Rahul Verma unlocked.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^Copy to / }));
    expect(await within(panel).findByText('Targets copied for 1 person.')).toBeInTheDocument();
    const [, next] = writes(client).map(([, , , options]) => options);
    expect(writes(client)[0]![1]).toBe('/v1/targets/unlock');
    expect(next).toMatchObject({ body: { from: PERIOD, userIds: [RAHUL] } });
  });
});
