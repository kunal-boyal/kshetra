import { ApiError } from '@thelamp/api-client';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ADMIN = '01a10000-0000-7000-8000-000000000002';
const PRIYA = '01a10000-0000-7000-8000-000000000003';
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const DELHI = '01a10000-0000-7000-8000-000000000010';

const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const DESIGNATIONS = [
  { key: 'head', name: noun('Head', 'Heads'), level: 1, ranked: false },
  { key: 'manager', name: noun('Manager', 'Managers'), level: 2, ranked: false },
  { key: 'executive', name: noun('Executive', 'Executives'), level: 3, ranked: true },
];

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: `SUN-${id.slice(-3)}`,
    name,
    phone: '+919000000004',
    email: null,
    designation: 'executive',
    role: 'field_user',
    managerId: PRIYA,
    manager: { id: PRIYA, code: 'SUN-003', name: 'Priya Nair' },
    joiningDate: '2026-04-01',
    exitDate: null,
    calendarKey: null,
    status: 'active',
    territories: [{ id: DELHI, code: 'N-DEL', name: 'Delhi Area' }],
    custom: {},
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:00:00.000Z',
    device: null,
    ...overrides,
  };
}

const RAHUL_VIEW = person(RAHUL, 'Rahul Verma', {
  device: {
    id: '01a10000-0000-7000-8000-000000000020',
    platform: 'android',
    model: 'Field phone',
    osVersion: '15',
    appVersion: '0.2.0',
    boundAt: '2026-10-06T07:00:00.000Z',
    lastSeenAt: '2026-10-07T08:00:00.000Z',
    health: {
      appVersion: '0.2.0',
      osVersion: '15',
      permissions: {},
      queue: { queued: 2, parked: 1, oldestQueuedAt: null },
      lastSyncAt: '2026-10-07T08:00:00.000Z',
      receivedAt: '2026-10-07T08:00:00.000Z',
      clockSkewSeconds: 0,
    },
  },
});
const PRIYA_VIEW = person(PRIYA, 'Priya Nair', {
  designation: 'manager',
  role: 'manager',
  manager: null,
  managerId: null,
  territories: [],
});

/** A form Rahul filled. */
function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a10000-0000-7000-8000-0000000000e0',
    user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
    form: { key: 'customer_visit', version: 1, name: noun('Customer visit', 'Customer visits') },
    account: null,
    visitId: null,
    shiftId: null,
    capturedAt: '2026-10-13T06:00:00.000Z',
    receivedAt: '2026-10-13T06:00:05.000Z',
    location: { lat: 28.6315, lng: 77.2167 },
    accuracy: 12,
    distanceM: null,
    geofence: null,
    values: {},
    photos: [],
    signatureMediaId: null,
    flags: [],
    status: 'pending',
    autoApproved: false,
    ...overrides,
  };
}

type Answer = (body: unknown) => unknown;

/** A signed-in admin's client: GETs answer from `pages`, writes from `writes`, by path. */
function fakeClient(writes: Record<string, Answer> = {}) {
  const pages: Record<string, unknown> = {
    '/v1/users': { items: [PRIYA_VIEW, RAHUL_VIEW], nextCursor: null },
    [`/v1/users/${RAHUL}`]: RAHUL_VIEW,
    [`/v1/users/${PRIYA}`]: PRIYA_VIEW,
    [`/v1/users/${RAHUL}/transfers`]: { items: [] },
    '/v1/shifts': {
      items: [
        {
          id: '01a10000-0000-7000-8000-0000000000c1',
          userId: RAHUL,
          startedAt: '2026-10-13T03:30:00.000Z',
          startLocation: { lat: 28.6315, lng: 77.2167 },
          startAccuracy: 12,
          consentVersion: '2026-10',
          selfieMediaId: null,
          endedAt: '2026-10-13T12:30:00.000Z',
          endLocation: { lat: 28.6315, lng: 77.2167 },
          endAccuracy: 14,
          endReason: 'punch_out',
          distanceM: 18_450,
          onDutySeconds: 8 * 3_600 + 30 * 60,
          pauses: [
            {
              id: '01a10000-0000-7000-8000-0000000000c2',
              pausedAt: '2026-10-13T07:30:00.000Z',
              resumedAt: '2026-10-13T08:00:00.000Z',
              reason: 'Lunch',
            },
          ],
          flags: ['clock_skew'],
        },
        {
          id: '01a10000-0000-7000-8000-0000000000c3',
          userId: RAHUL,
          startedAt: '2026-10-12T03:30:00.000Z',
          startLocation: { lat: 28.6315, lng: 77.2167 },
          startAccuracy: 12,
          consentVersion: '2026-10',
          selfieMediaId: null,
          endedAt: '2026-10-12T17:30:00.000Z',
          endLocation: null,
          endAccuracy: null,
          endReason: 'auto_closed',
          distanceM: null,
          onDutySeconds: 14 * 3_600,
          pauses: [],
          flags: [],
        },
      ],
      nextCursor: null,
    },
    '/v1/submissions': {
      items: [
        submission({
          id: '01a10000-0000-7000-8000-0000000000e1',
          account: {
            id: '01a10000-0000-7000-8000-0000000000a1',
            code: 'C-1',
            name: 'Sharma Stores',
          },
          geofence: 'outside',
          distanceM: 640,
          photos: ['01a10000-0000-7000-8000-0000000000f1', '01a10000-0000-7000-8000-0000000000f2'],
          flags: ['outside_geofence', 'gallery_photo'],
        }),
        submission({
          id: '01a10000-0000-7000-8000-0000000000e2',
          form: { key: 'meeting', version: 1, name: noun('Meeting', 'Meetings') },
          status: 'approved',
        }),
      ],
      nextCursor: null,
    },
    '/v1/attendance': {
      userId: RAHUL,
      period: '2026-10',
      days: [
        {
          date: '2026-10-12',
          status: 'present',
          value: 1,
          firstIn: null,
          lastOut: null,
          hours: 14,
        },
        {
          date: '2026-10-13',
          status: 'present',
          value: 1,
          firstIn: null,
          lastOut: null,
          hours: 8.5,
        },
        { date: '2026-10-11', status: 'absent', value: 0, firstIn: null, lastOut: null, hours: 0 },
        { date: '2026-10-31', status: 'future', value: 0, firstIn: null, lastOut: null, hours: 0 },
      ],
      summary: { scheduled: 3, paid: 2 },
    },
    '/v1/leave-types': {
      items: [
        {
          key: 'casual',
          name: { en: 'Casual leave', hi: 'आकस्मिक अवकाश' },
          paid: true,
          annualQuota: 12,
          quotaYear: 'calendar',
          halfDayAllowed: true,
          active: true,
        },
        {
          key: 'unpaid',
          name: { en: 'Unpaid leave', hi: 'अवैतनिक अवकाश' },
          paid: false,
          annualQuota: 0,
          quotaYear: 'calendar',
          halfDayAllowed: true,
          active: true,
        },
      ],
    },
    '/v1/leave-balances': {
      userId: RAHUL,
      on: '2026-10-24',
      items: [
        {
          leaveType: 'casual',
          from: '2026-01-01',
          to: '2026-12-31',
          quota: 12,
          approved: 4,
          pending: 1.5,
          available: 6.5,
        },
        {
          leaveType: 'unpaid',
          from: '2026-01-01',
          to: '2026-12-31',
          quota: null,
          approved: 2,
          pending: 0,
          available: null,
        },
      ],
    },
    '/v1/leave-requests': {
      items: [
        {
          id: '01a10000-0000-7000-8000-0000000000d1',
          userId: RAHUL,
          leaveType: 'casual',
          startDate: '2026-10-05',
          endDate: '2026-10-06',
          halfDay: false,
          days: 2,
          reason: null,
          attachmentId: null,
          state: 'approved',
          approval: null,
          createdAt: '2026-10-01T05:00:00.000Z',
          decidedAt: '2026-10-02T05:00:00.000Z',
        },
        {
          id: '01a10000-0000-7000-8000-0000000000d2',
          userId: RAHUL,
          leaveType: 'casual',
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          halfDay: true,
          days: 0.5,
          reason: null,
          attachmentId: null,
          state: 'pending',
          approval: null,
          createdAt: '2026-10-20T05:00:00.000Z',
          decidedAt: null,
        },
      ],
    },
    '/v1/calendars': {
      year: 2026,
      items: [
        {
          key: 'standard',
          name: { en: 'Standard', hi: 'सामान्य' },
          weeklyOffs: [7],
          default: true,
          holidays: [],
        },
        {
          key: 'south',
          name: { en: 'South zone', hi: 'दक्षिण क्षेत्र' },
          weeklyOffs: [7],
          default: false,
          holidays: [],
        },
      ],
    },
    [`/v1/users/${RAHUL}/history`]: {
      items: [
        {
          id: '01a10000-0000-7000-8000-000000000030',
          actor: { kind: 'system', id: null },
          action: 'user.created',
          target: { type: 'user', id: RAHUL },
          before: null,
          after: null,
          ip: null,
          deviceId: null,
          supportGrantId: null,
          createdAt: '2026-10-06T07:00:00.000Z',
        },
      ],
      nextCursor: null,
    },
    '/v1/org-chart': {
      items: [
        {
          id: PRIYA,
          code: 'SUN-003',
          name: 'Priya Nair',
          designation: 'manager',
          status: 'active',
          managerId: null,
          reports: 1,
          team: { executive: 1 },
        },
      ],
      totals: { manager: 1, executive: 1 },
    },
    [`/v1/org-chart?managerId=${PRIYA}`]: {
      items: [
        {
          id: RAHUL,
          code: 'SUN-004',
          name: 'Rahul Verma',
          designation: 'executive',
          status: 'active',
          managerId: PRIYA,
          reports: 0,
          team: {},
        },
      ],
      totals: { executive: 1 },
    },
    '/v1/territories': {
      items: [
        { id: DELHI, parentId: null, level: 1, code: 'N-DEL', name: 'Delhi Area', active: true },
      ],
    },
    '/v1/user-fields': {
      fields: [
        {
          key: 'hq',
          type: 'short_text',
          label: { en: 'HQ', hi: 'मुख्यालय' },
          required: false,
          maxLength: 200,
        },
      ],
      retired: [],
    },
    '/v1/roles': {
      items: [
        {
          id: '01a10000-0000-7000-8000-000000000040',
          key: 'field_user',
          name: { en: 'Field user', hi: 'फ़ील्ड यूज़र' },
          scope: 'self',
          permissions: ['shift.use'],
          mobileOnly: true,
          system: true,
        },
      ],
    },
    '/v1/designations': {
      items: DESIGNATIONS.map((designation, index) => ({
        ...designation,
        id: `01a10000-0000-7000-8000-00000000005${index}`,
        defaultRole: 'field_user',
        canHaveReports: designation.level < 3,
      })),
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
    switchTenant: vi.fn(),
    me: vi.fn(async () => ({
      userId: ADMIN,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-001',
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
      scope: 'tenant',
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
        designations: DESIGNATIONS,
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: [
            'user.view',
            'user.manage',
            'user.reset_device',
            'user.sign_out_all',
            'role.manage',
            'designation.manage',
            'settings.manage',
            'calendar.manage',
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
  return memory;
}

const writes = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls.filter(([method]) => method !== 'GET');

describe('the people table', () => {
  it('shows each person with their designation, manager, territory and phone, and searches', async () => {
    const client = fakeClient();
    renderAt('/people', client);
    const table = await screen.findByRole('table', { name: 'People in your organisation' });
    const rahul = within(table).getByRole('row', { name: /Rahul Verma/ });
    expect(rahul).toHaveTextContent('Executive');
    expect(rahul).toHaveTextContent('Priya Nair');
    expect(rahul).toHaveTextContent('Delhi Area');
    expect(rahul).toHaveTextContent('Field phone');
    expect(within(table).getByRole('row', { name: /^Priya Nair/ })).toHaveTextContent('No phone');

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'rah');
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        '/v1/users?q=rah&status=active&limit=50',
        expect.anything(),
      ),
    );
  });
});

describe('signing everyone out (D101)', () => {
  it('asks first, then says how many people were signed out', async () => {
    const client = fakeClient({ 'POST /v1/users/sign-out-everyone': () => ({ people: 12 }) });
    renderAt('/people', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign everyone out' }));
    expect(writes(client)).toEqual([]);
    const confirm = screen.getByRole('group', { name: /Sign everyone else out/ });
    await user.click(within(confirm).getByRole('button', { name: 'Sign everyone out' }));
    expect(await screen.findByRole('status')).toHaveTextContent('12 people were signed out.');
    expect(writes(client).map(([method, path]) => `${method} ${path}`)).toEqual([
      'POST /v1/users/sign-out-everyone',
    ]);
  });
});

describe("a person's page", () => {
  it('shows their month so far and their shifts, with how each ended', async () => {
    renderAt(`/people/${RAHUL}`, fakeClient());
    const work = await screen.findByRole('region', { name: 'Work' });
    expect(await within(work).findByText('Days present this month')).toBeInTheDocument();
    expect(work).toHaveTextContent(/Days present this month\s*2/);
    expect(work).toHaveTextContent(/Days absent\s*1/);
    expect(work).toHaveTextContent(/Hours on duty\s*22.5/);
    expect(work).toHaveTextContent(/Working days\s*3/);
    expect(work).toHaveTextContent(/Paid days\s*2/);
    const table = within(work).getByRole('table', { name: 'Shifts, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('8 h 30 min');
    expect(rows[0]).toHaveTextContent('18.5 km');
    expect(rows[0]).toHaveTextContent('1 pause');
    expect(rows[0]).toHaveTextContent('Phone clock was off');
    expect(rows[1]).toHaveTextContent('Closed at night');
    expect(rows[1]).toHaveTextContent('—');
  });

  it("shows their leave balances and this year's requests", async () => {
    renderAt(`/people/${RAHUL}`, fakeClient());
    const leave = await screen.findByRole('region', { name: 'Leave' });
    const balances = await within(leave).findByRole('table', { name: 'Balances' });
    expect(within(balances).getByRole('row', { name: /Casual leave/ })).toHaveTextContent(
      /12\s*4\s*1\.5\s*6\.5/,
    );
    expect(within(balances).getByRole('row', { name: /Unpaid leave/ })).toHaveTextContent(
      'No limit',
    );
    const requests = within(leave).getByRole('table', { name: 'Requests this year' });
    const rows = within(requests).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/5 Oct 2026 to 6 Oct 2026.*Casual leave.*2.*Approved/);
    expect(rows[1]).toHaveTextContent(/2 Nov 2026.*Half day.*Waiting/);
  });

  it('keeps them on a holiday calendar, the default unless one is chosen', async () => {
    const client = fakeClient({
      [`PUT /v1/users/${RAHUL}/calendar`]: (body) => ({ userId: RAHUL, ...(body as object) }),
    });
    renderAt(`/people/${RAHUL}`, client);
    const work = await screen.findByRole('region', { name: 'Work' });
    const calendar = await within(work).findByRole('combobox', { name: 'Holiday calendar' });
    expect(calendar).toHaveDisplayValue('The default (Standard)');
    await userEvent.setup().selectOptions(calendar, 'south');
    expect(await within(work).findByText(/Calendar changed/)).toBeVisible();
    expect(
      writes(client).map(([method, path, , options]) => [method, path, options?.body]),
    ).toEqual([['PUT', `/v1/users/${RAHUL}/calendar`, { calendarKey: 'south' }]]);
  });

  it('shows the forms they filled, where, and what a reviewer should look at', async () => {
    renderAt(`/people/${RAHUL}`, fakeClient());
    const filled = await screen.findByRole('region', { name: 'Forms filled' });
    const table = await within(filled).findByRole('table', { name: 'Forms filled, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Customer visit');
    expect(within(rows[0]!).getByRole('link', { name: 'Sharma Stores' })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Outside, 640 m away');
    expect(rows[0]).toHaveTextContent('Waiting for review');
    expect(rows[0]).toHaveTextContent('2 photos');
    expect(rows[0]).toHaveTextContent('Outside the geofence');
    expect(rows[0]).toHaveTextContent('Photo from the gallery');
    expect(rows[1]).toHaveTextContent('Meeting');
    expect(rows[1]).toHaveTextContent('No account');
    expect(rows[1]).toHaveTextContent('Approved');
  });

  it('shows their phone, and resets it only after asking, warning of unsent records', async () => {
    const client = fakeClient({ [`POST /v1/users/${RAHUL}/reset-device`]: () => undefined });
    renderAt(`/people/${RAHUL}`, client);
    expect(await screen.findByRole('heading', { name: 'Rahul Verma' })).toBeInTheDocument();
    const phone = screen.getByRole('region', { name: 'Phone' });
    expect(phone).toHaveTextContent('2 waiting, 1 refused');
    // The history reads on its own, after the person.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'History' })).toHaveTextContent('Added'),
    );

    const user = userEvent.setup();
    await user.click(within(phone).getByRole('button', { name: 'Reset phone' }));
    const question = screen.getByRole('group', { name: /Reset Rahul Verma's phone/ });
    expect(question).toHaveTextContent('3 records not yet uploaded');
    expect(writes(client)).toEqual([]);
    await user.click(within(question).getByRole('button', { name: 'Reset phone' }));
    expect(await screen.findByText('The phone is reset.')).toBeInTheDocument();
    expect(writes(client)).toEqual([
      [
        'POST',
        `/v1/users/${RAHUL}/reset-device`,
        expect.anything(),
        { idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('says so when the person is out of reach', async () => {
    const client = fakeClient();
    renderAt('/people/01a10000-0000-7000-8000-000000000099', client);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was not found. It may have been removed.',
    );
  });
});

describe('adding a person', () => {
  it('sends what was entered, and shows the server’s problems by field', async () => {
    let tries = 0;
    const client = fakeClient({
      'POST /v1/users': () => {
        tries += 1;
        if (tries === 1) {
          throw new ApiError(409, 'CONFLICT', 'Taken.', [
            { path: 'code', issue: 'Another user has this code' },
          ]);
        }
        return { ...RAHUL_VIEW, id: RAHUL };
      },
    });
    const router = renderAt('/people/new', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Code *'), 'SUN-009');
    await user.type(screen.getByLabelText('Name *'), 'Nisha New');
    await user.selectOptions(screen.getByLabelText('Designation *'), 'executive');
    await user.click(screen.getByRole('checkbox', { name: /Delhi Area/ }));
    await user.type(screen.getByLabelText('HQ'), 'Karnal');
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('Another user has this code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/people/${RAHUL}`));
    expect(writes(client)[0]![3]).toMatchObject({
      body: {
        code: 'SUN-009',
        name: 'Nisha New',
        designation: 'executive',
        managerId: null,
        territoryIds: [DELHI],
        custom: { hq: 'Karnal' },
      },
    });
  });
});

describe('a transfer', () => {
  it('sends only what changes, from the chosen day', async () => {
    const client = fakeClient({
      [`POST /v1/users/${RAHUL}/transfers`]: (body) => ({ id: 't', ...(body as object) }),
    });
    const router = renderAt(`/people/${RAHUL}/transfer`, client);
    const user = userEvent.setup();
    const from = await screen.findByLabelText('From *');
    await user.clear(from);
    await user.type(from, '2030-01-15');
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(await screen.findByText('Choose something to change.')).toBeInTheDocument();
    expect(writes(client)).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Designation'), 'manager');
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/people/${RAHUL}`));
    expect(writes(client)[0]![3]).toMatchObject({
      body: { effectiveDate: '2030-01-15', designation: 'manager' },
    });
  });
});

describe('the organisation chart', () => {
  it('shows team counts, and opens a level on request', async () => {
    renderAt('/org-chart', fakeClient());
    expect(await screen.findByText('1 Manager · 1 Executive')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: "Show Priya Nair's team" }));
    expect(await screen.findByRole('link', { name: 'Rahul Verma' })).toBeInTheDocument();
  });
});

describe('settings', () => {
  it('adds a role with the permissions ticked', async () => {
    const client = fakeClient({ 'POST /v1/roles': (body) => body });
    renderAt('/settings/roles', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a role' }));
    const form = screen.getByRole('form', { name: 'New role' });
    await user.type(within(form).getByLabelText('Key *'), 'area_lead');
    await user.type(within(form).getByLabelText('Name in English *'), 'Area lead');
    await user.type(within(form).getByLabelText('Name in Hindi *'), 'क्षेत्र प्रमुख');
    await user.selectOptions(within(form).getByLabelText('Whose records it reaches'), 'team');
    await user.click(within(form).getByRole('checkbox', { name: /View people/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(client)).toHaveLength(1));
    expect(writes(client)[0]![3]).toMatchObject({
      body: {
        key: 'area_lead',
        name: { en: 'Area lead', hi: 'क्षेत्र प्रमुख' },
        scope: 'team',
        mobileOnly: false,
        permissions: ['user.view'],
      },
      idempotencyKey: expect.any(String),
    });
  });

  it('saves the people fields as a whole list', async () => {
    const client = fakeClient({
      'PUT /v1/user-fields': (body) => ({ ...(body as object), retired: [] }),
    });
    renderAt('/settings/people-fields', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a field' }));
    const keys = screen.getAllByLabelText('Key *');
    await user.type(keys[1]!, 'crops');
    await user.selectOptions(screen.getAllByLabelText('Type')[1]!, 'multi_select');
    await user.type(screen.getAllByLabelText('Label in English *')[1]!, 'Crops');
    await user.type(screen.getByLabelText('Choices'), 'paddy | Paddy | धान');
    await user.click(screen.getByRole('button', { name: 'Save fields' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(writes(client)[0]![3]).toMatchObject({
      body: {
        fields: [
          { key: 'hq', type: 'short_text', label: { en: 'HQ', hi: 'मुख्यालय' } },
          {
            key: 'crops',
            type: 'multi_select',
            label: { en: 'Crops', hi: 'Crops' },
            required: false,
            options: [{ key: 'paddy', label: { en: 'Paddy', hi: 'धान' } }],
          },
        ],
      },
    });
  });
});
