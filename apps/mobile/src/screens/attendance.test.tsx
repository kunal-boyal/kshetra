import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate, Outbox } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { AttendanceScreen } from './attendance';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${ASHA}`;
const DAY = 86_400_000;

const TODAY = todayIn('Asia/Kolkata');
const after = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** Last month, whole whatever today is. */
const PERIOD = after(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const DATES = (() => {
  const dates: string[] = [];
  for (let date = `${PERIOD}-01`; date.startsWith(PERIOD); date = after(date, 1)) dates.push(date);
  return dates;
})();
const [WORKED, MISSED, FESTIVAL, ASKED] = DATES.filter((date) => weekday(date) !== 7);

/** A month as the server answers it: Sundays off, one day worked, a holiday, a day asked about. */
function month(period: string) {
  const days = (period === PERIOD ? DATES : []).map((date) => {
    const base = { date, value: 0, firstIn: null, lastOut: null, hours: 0, holiday: null };
    if (weekday(date) === 7) return { ...base, status: 'weekly_off', regularisation: null };
    if (date === WORKED)
      return { ...base, status: 'present', value: 1, hours: 8.5, regularisation: null };
    if (date === FESTIVAL) {
      return { ...base, status: 'holiday', holiday: 'Founders Day', regularisation: null };
    }
    if (date === ASKED) {
      return {
        ...base,
        status: 'absent',
        regularisation: {
          id: '01a10000-0000-7000-8000-0000000000r1',
          status: 'half_day',
          state: 'pending',
        },
      };
    }
    return { ...base, status: 'absent', regularisation: null };
  });
  const sundays = days.filter((day) => day.status === 'weekly_off').length;
  return {
    userId: ASHA,
    period,
    days,
    summary: { scheduled: days.length - sundays - 1, paid: 1 },
  };
}

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function fakeClient(offline = false, permissions = ['shift.use', 'regularisation.request']) {
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
      if (method === 'GET' && url.startsWith('/v1/attendance?')) {
        return month(new URLSearchParams(url.split('?')[1]).get('period')!);
      }
      // Requests to fix a day wait for a signal, as in a field with none.
      if (method === 'POST' && url === '/v1/regularisations') throw new NetworkError('offline');
      if (method === 'GET' && url === '/v1/leave-types') return { items: LEAVE_TYPES };
      if (method === 'GET' && url === '/v1/leave-balances') return LEAVE_BALANCES;
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
          access: { role: 'field_user', scope: 'self', permissions },
        },
      };
    }),
  };
  return { client, create: () => client as unknown as MobileClient };
}

const LEAVE_TYPES = [
  {
    key: 'casual',
    name: { en: 'Casual', hi: 'आकस्मिक' },
    paid: true,
    annualQuota: 8,
    quotaYear: 'calendar',
    halfDayAllowed: true,
    active: true,
  },
  {
    key: 'unpaid',
    name: { en: 'Unpaid', hi: 'अवैतनिक' },
    paid: false,
    annualQuota: 0,
    quotaYear: 'calendar',
    halfDayAllowed: false,
    active: true,
  },
];
const LEAVE_BALANCES = {
  userId: ASHA,
  on: '2026-10-28',
  items: [
    {
      leaveType: 'casual',
      from: '2026-01-01',
      to: '2026-12-31',
      quota: 8,
      approved: 3,
      pending: 0,
      available: 5,
    },
    {
      leaveType: 'unpaid',
      from: '2026-01-01',
      to: '2026-12-31',
      quota: null,
      approved: 0,
      pending: 0,
      available: null,
    },
  ],
};

function Shown() {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return <AttendanceScreen />;
}

async function renderPhone(
  options: { offline?: boolean; db?: ReturnType<typeof nodeSqlite>; permissions?: string[] } = {},
) {
  const fake = fakeClient(options.offline, options.permissions);
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
            <Shown />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return { client: fake.client, db, view };
}

/** Opens last month, which is whole whatever today is. */
async function lastMonth() {
  await fireEvent.press(await screen.findByRole('button', { name: 'Previous month' }));
  await screen.findByRole('button', { name: new RegExp(`^${shortDate(WORKED!)}: Present$`) });
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

describe('attendance on the phone (M13, spec 8.1)', () => {
  it('says what is left of leave with a quota this year, and asks for more', async () => {
    await renderPhone();
    expect(await screen.findByText('Leave left this year')).toBeOnTheScreen();
    expect(screen.getByText('5')).toBeOnTheScreen();
    expect(screen.getByText('Casual')).toBeOnTheScreen();
    // A type without a quota has nothing to count.
    expect(screen.queryByText('Unpaid')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    expect(router.push).toHaveBeenCalledWith('/leave/new');
  });

  it('shows the month as a calendar, with working and paid days', async () => {
    const { client } = await renderPhone();
    await lastMonth();
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      `/v1/attendance?userId=${ASHA}&period=${PERIOD}`,
      expect.anything(),
    );
    const sundays = DATES.filter((date) => weekday(date) === 7).length;
    expect(
      screen.getByText(`Working days ${DATES.length - sundays - 1} · Paid days 1`),
    ).toBeOnTheScreen();
    // The legend counts each status the month has.
    expect(screen.getByText(`Weekly off ${sundays}`)).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /: Weekly off$/ })).toHaveLength(sundays);
    // Next month goes no further than this one.
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: `${shortDate(FESTIVAL!)}: Holiday` }),
    );
    expect(screen.getByText('Holiday: Founders Day')).toBeOnTheScreen();
    // A holiday is a day that can still be asked about, as worked.
    expect(screen.getByRole('button', { name: 'Ask to fix this day' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: `${shortDate(ASKED!)}: Absent` }));
    expect(
      screen.getByText('Asked to count it as Half day; waiting for approval'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ask to fix this day' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: `${shortDate(WORKED!)}: Present` }));
    expect(screen.getByText('8.5 hours on duty')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ask to fix this day' })).toBeNull();
  });

  it('asks to fix a missed day, which waits on the phone until there is signal', async () => {
    const { db } = await renderPhone();
    await lastMonth();
    await fireEvent.press(screen.getByRole('button', { name: `${shortDate(MISSED!)}: Absent` }));
    await fireEvent.press(screen.getByRole('radio', { name: /Half day/ }));
    await fireEvent.changeText(screen.getByLabelText(/^Reason/), 'ok');
    await fireEvent.press(screen.getByRole('button', { name: 'Ask to fix this day' }));
    expect(await screen.findByText('Write at least 3 characters')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(/^Reason/), 'Met the stockist at the depot');
    await fireEvent.press(screen.getByRole('button', { name: 'Ask to fix this day' }));
    expect(
      await screen.findByText('Asked to count it as Half day; sends when there is signal'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ask to fix this day' })).toBeNull();
    await waitFor(async () => {
      const [item] = await new Outbox(db, {}).items(OWNER);
      expect(item).toMatchObject({
        kind: 'regularisation.create',
        payload: { date: MISSED, status: 'half_day', reason: 'Met the stockist at the depot' },
      });
    });
  });

  it('shows the month read last when there is no signal, and asks nothing of those who can’t', async () => {
    const first = await renderPhone({ permissions: ['shift.use'] });
    await lastMonth();
    await fireEvent.press(screen.getByRole('button', { name: `${shortDate(MISSED!)}: Absent` }));
    expect(screen.queryByRole('button', { name: 'Ask to fix this day' })).toBeNull();
    await first.view.unmount();

    await renderPhone({ offline: true, db: first.db });
    await lastMonth();
    expect(screen.getByText(/^As of /)).toBeOnTheScreen();
    expect(screen.getByText(/^Weekly off \d+$/)).toBeOnTheScreen();
  });
});
