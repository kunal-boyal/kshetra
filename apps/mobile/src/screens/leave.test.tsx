import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate, Outbox } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { LeaveScreen } from './leave';
import { NewLeaveScreen } from './new-leave';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useFocusEffect: () => undefined,
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${ASHA}`;
const DAY = 86_400_000;
const after = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const TODAY = todayIn('Asia/Kolkata');
/** Next month, whole, whatever today is. */
const NEXT = after(`${TODAY.slice(0, 7)}-28`, 7).slice(0, 7);
const firstOf = (iso: number) => {
  let at = `${NEXT}-01`;
  while (weekday(at) !== iso) at = after(at, 1);
  return at;
};
/** FX-20 next month: Friday to Monday, Saturday a holiday and Sunday off. */
const FRIDAY = firstOf(5);
const MONDAY = after(FRIDAY, 3);
/** A day already asked for, the week after. */
const ASKED = after(FRIDAY, 7);
const YEAR = TODAY.slice(0, 4);

const type = (key: string, en: string, extra: object = {}) => ({
  key,
  name: { en, hi: en },
  paid: true,
  annualQuota: 12,
  quotaYear: 'calendar',
  halfDayAllowed: true,
  active: true,
  ...extra,
});
const TYPES = [
  type('casual', 'Casual leave'),
  type('sick', 'Sick leave', { attachmentAfterDays: 2 }),
  type('unpaid', 'Unpaid leave', { paid: false, annualQuota: 0 }),
];
const BALANCES = {
  userId: ASHA,
  on: TODAY,
  items: [
    {
      leaveType: 'casual',
      from: `${YEAR}-01-01`,
      to: `${YEAR}-12-31`,
      quota: 12,
      approved: 4,
      pending: 1.5,
      available: 6.5,
    },
    {
      leaveType: 'unpaid',
      from: `${YEAR}-01-01`,
      to: `${YEAR}-12-31`,
      quota: null,
      approved: 2,
      pending: 0,
      available: null,
    },
  ],
};
const request = (id: string, startDate: string, endDate: string, state: string, extra = {}) => ({
  id,
  userId: ASHA,
  leaveType: 'casual',
  startDate,
  endDate,
  halfDay: false,
  days: 1,
  reason: null,
  attachmentId: null,
  state,
  approval: null,
  createdAt: `${YEAR}-01-02T05:00:00.000Z`,
  decidedAt: null,
  ...extra,
});
const REQUESTS = [
  request('01a10000-0000-7000-8000-0000000000d1', `${YEAR}-01-05`, `${YEAR}-01-06`, 'approved', {
    days: 2,
  }),
  request('01a10000-0000-7000-8000-0000000000d2', ASKED, ASKED, 'pending'),
];
const calendars = (year: string) => ({
  year: Number(year),
  items: [
    {
      key: 'standard',
      name: { en: 'Standard', hi: 'सामान्य' },
      weeklyOffs: [7],
      default: true,
      holidays: [{ date: after(FRIDAY, 1), name: 'Spring festival', optional: false }],
    },
  ],
});

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function fakeClient(offline = false) {
  const session: SessionState = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const client = {
    session,
    owner: OWNER,
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => undefined),
    me: jest.fn(async () => {
      if (offline) throw new NetworkError('offline');
      return {
        userId: ASHA,
        tenantId: TENANT.id,
        cell: 'local',
        code: 'SUN-004',
        name: 'Asha Rao',
        designation: 'executive',
        role: 'field_user',
        scope: 'self',
        permissions: ['leave.request'],
        deviceId: null,
        calendarKey: null,
      };
    }),
    syncPull: jest.fn(async (): Promise<SyncPullResult> => {
      if (offline) throw new NetworkError('offline');
      return {
        entities: {
          users: full([]),
          territories: full([]),
          accounts: full([]),
          contacts: full([]),
          items: full([]),
        },
        cursor: 'c1',
        more: false,
      };
    }),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async (method, path) => {
      if (offline) throw new NetworkError('offline');
      const url = String(path);
      if (method === 'GET' && url === '/v1/leave-types') return { items: TYPES };
      if (method === 'GET' && url === '/v1/leave-balances') return BALANCES;
      if (method === 'GET' && url.startsWith('/v1/leave-requests?')) {
        return {
          items:
            url.endsWith(`year=${YEAR}`) || url.endsWith(`year=${NEXT.slice(0, 4)}`)
              ? REQUESTS
              : [],
          people: [],
        };
      }
      if (method === 'GET' && url.startsWith('/v1/calendars?year=')) {
        return calendars(url.slice(-4));
      }
      // Requests wait for a signal, as in a field with none.
      if (method === 'POST') throw new NetworkError('offline');
      return {};
    }),
    config: jest.fn(async () => {
      if (offline) throw new NetworkError('offline');
      return {
        status: 'fresh',
        etag: '"1-role-4"',
        bundle: {
          version: 1,
          settings: SETTING_DEFAULTS,
          terminology: {},
          designations: [],
          accountTypes: [],
          forms: [],
          catalogue: { units: [], measureTypes: [] },
          access: { role: 'field_user', scope: 'self', permissions: ['leave.request'] },
        },
      };
    }),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'leave' | 'new' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'leave' ? <LeaveScreen /> : <NewLeaveScreen />;
}

async function renderPhone(
  page: 'leave' | 'new',
  options: { offline?: boolean; db?: ReturnType<typeof nodeSqlite> } = {},
) {
  const fake = fakeClient(options.offline);
  const db = options.db ?? nodeSqlite();
  if (!options.db) {
    await migrate(db);
    await claim(db, OWNER);
  }
  const view = await render(
    <LanguageProvider initial="en">
      <AppProvider
        createClient={fake.create}
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
        }
      >
        <SyncProvider openDatabase={async () => db}>
          <Look>
            <Shown page={page} />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return { client: fake.client, db, view };
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** Moves the picker to next month and picks a range. */
async function pickRange(first: string, last: string) {
  await fireEvent.press(await screen.findByRole('button', { name: 'Next month' }));
  await fireEvent.press(await screen.findByRole('button', { name: shortDate(first) }));
  const lastDay = screen.queryByRole('button', { name: shortDate(last) });
  await fireEvent.press(
    lastDay ?? screen.getByRole('button', { name: new RegExp(`^${shortDate(last)}`) }),
  );
}

describe('leave on the phone (M13, spec 8.1)', () => {
  it('shows each balance, this year’s requests, and the way to ask', async () => {
    await renderPhone('leave');
    expect(await screen.findByText('6.5 of 12 left · 4 taken · 1.5 waiting')).toBeOnTheScreen();
    expect(screen.getByText('No limit · 2 taken')).toBeOnTheScreen();
    expect(
      screen.getByText(
        `${shortDate(`${YEAR}-01-05`)} to ${shortDate(`${YEAR}-01-06`)} · 2 working days`,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Approved')).toBeOnTheScreen();
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Ask for leave' }));
    expect(router.push).toHaveBeenCalledWith('/leave/new');
  });

  it('counts working days on the calendar and queues the request (FX-20)', async () => {
    const { db } = await renderPhone('new');
    await pickRange(FRIDAY, MONDAY);
    expect(
      screen.getByRole('button', { name: `${shortDate(after(FRIDAY, 1))}, chosen` }),
    ).toBeOnTheScreen();
    expect(await screen.findByText('2 working days')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Reason/), 'Family wedding');
    await fireEvent.press(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(async () => {
      const [item] = await new Outbox(db, {}).items(OWNER);
      expect(item).toMatchObject({
        kind: 'leave_request.create',
        payload: {
          leaveType: 'casual',
          startDate: FRIDAY,
          endDate: MONDAY,
          halfDay: false,
          reason: 'Family wedding',
        },
      });
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('says what the server would refuse before sending', async () => {
    await renderPhone('new');
    await pickRange(after(ASKED, -1), ASKED);
    expect(
      await screen.findByText('You have leave on some of these days already'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send the request' })).toBeDisabled();

    // Sick leave past two days needs a document photo.
    await fireEvent.press(screen.getByRole('radio', { name: /Sick leave/ }));
    await fireEvent.press(
      screen.getByRole('button', { name: new RegExp(`^${shortDate(MONDAY)}`) }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: new RegExp(`^${shortDate(after(MONDAY, 2))}`) }),
    );
    expect(await screen.findByText(/needs a document/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Photograph the document' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send the request' })).toBeDisabled();
  });

  it('shows the balances read last when there is no signal', async () => {
    const first = await renderPhone('leave');
    expect(await screen.findByText('6.5 of 12 left · 4 taken · 1.5 waiting')).toBeOnTheScreen();
    await first.view.unmount();
    await renderPhone('leave', { offline: true, db: first.db });
    expect(await screen.findByText('6.5 of 12 left · 4 taken · 1.5 waiting')).toBeOnTheScreen();
    expect(screen.getByText(/^As of /)).toBeOnTheScreen();
  });
});
