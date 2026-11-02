import { describe, expect, it, jest } from '@jest/globals';
import { ApiError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { MyPayScreen } from './my-pay';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';

const THIS_MONTH = todayIn('Asia/Kolkata').slice(0, 7);
const LAST_MONTH = (() => {
  const [year, month] = THIS_MONTH.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
})();
const slip = (period: string, patch: object) => ({
  user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao', designation: 'executive' },
  period,
  monthlyGross: '30000.00',
  scheduled: 26,
  paid: 24,
  amount: '27692.31',
  toDate: false,
  days: {
    future: 0,
    not_employed: 0,
    present: 23,
    half_day: 0,
    paid_leave: 1,
    unpaid_leave: 0,
    holiday: 1,
    weekly_off: 4,
    absent: 2,
  },
  ...patch,
});
const SLIPS: Record<string, object | null> = {
  [`/v1/payslips/${ASHA}/${THIS_MONTH}`]: slip(THIS_MONTH, {
    paid: 10.5,
    amount: '12115.38',
    toDate: true,
  }),
  [`/v1/payslips/${ASHA}/${LAST_MONTH}`]: slip(LAST_MONTH, { monthlyGross: null, amount: null }),
};

const MONTH_BEFORE = (() => {
  const [year, month] = LAST_MONTH.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
})();
/** Last month's approved statutory payslip; the month before has none (D128). */
const STATUTORY: Record<string, object | null> = {
  [`/v1/statutory-payslips/${ASHA}/${LAST_MONTH}`]: {
    user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
    period: LAST_MONTH,
    status: 'approved',
    profile: {
      workState: 'MH',
      ptWomen: false,
      pfMember: true,
      pfFullWage: false,
      uan: '100200300400',
      esiNumber: null,
      panOnFile: true,
    },
    structure: {
      basic: '15000.00',
      da: '0.00',
      hra: '6000.00',
      conveyance: '0.00',
      special: '4000.00',
      others: [],
    },
    scheduled: 26,
    paid: 26,
    esiCovered: true,
    wages: '19000.00',
    earnings: [
      { key: 'basic', amount: '15000.00' },
      { key: 'hra', amount: '6000.00' },
      { key: 'special', amount: '4000.00' },
    ],
    deductions: [
      { key: 'pf', amount: '2280.00' },
      { key: 'esi', amount: '143.00' },
      { key: 'pt', amount: '200.00' },
    ],
    employer: [{ key: 'eps', amount: '1583.00' }],
    gross: '25000.00',
    totalDeductions: '2623.00',
    net: '22377.00',
    flags: [],
    rateSetId: 'reference-2026-09',
    reviewed: false,
  },
  [`/v1/statutory-payslips/${ASHA}/${MONTH_BEFORE}`]: null,
};

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function fakeClient(statutory = false) {
  const session: SessionState = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const client = {
    session,
    owner: `${TENANT.id}:${ASHA}`,
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => undefined),
    syncPull: jest.fn(async (): Promise<SyncPullResult> => ({
      entities: {
        users: full([]),
        territories: full([]),
        accounts: full([]),
        contacts: full([]),
        items: full([]),
      },
      cursor: 'c1',
      more: false,
    })),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async (method, path) => {
      const pages = statutory ? STATUTORY : SLIPS;
      const found = method === 'GET' ? pages[String(path)] : undefined;
      if (found === null) throw new ApiError(404, 'NOT_FOUND', 'No payslip.');
      if (!found) throw new Error(`Nothing at ${String(path)}`);
      return found;
    }),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        // Statutory payroll is opt-in, so bundles list it as off until it is on (D128).
        settings: {
          ...SETTING_DEFAULTS,
          modulesOff: statutory ? ['payroll_inputs'] : ['statutory_payroll'],
        },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'field_user', scope: 'self', permissions: ['payslip.view'] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown() {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return <MyPayScreen />;
}

async function renderPhone(statutory = false) {
  const fake = fakeClient(statutory);
  const db = nodeSqlite();
  await migrate(db);
  await claim(db, fake.client.owner);
  await render(
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
  return fake.client;
}

describe('my pay estimate on the phone (M14, decision D117)', () => {
  it('shows this month so far and last month, each as an estimate', async () => {
    await renderPhone();
    expect(await screen.findByText('Provisional pay so far: ₹12,115.38')).toBeOnTheScreen();
    expect(
      screen.getByText('Attendance-based estimate. This is not a statutory payroll document.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('10.5 of 26')).toBeOnTheScreen();
    expect(screen.getByText('₹30,000.00')).toBeOnTheScreen();
    // Last month had no gross: no estimate, only the days.
    expect(await screen.findByText('No monthly gross for this month')).toBeOnTheScreen();
    expect(screen.getByText('24 of 26')).toBeOnTheScreen();
  });
});

describe('my payslips on the phone (decision D128)', () => {
  it('shows last month’s approved payslip, with net pay in words and the review label', async () => {
    await renderPhone(true);
    expect(await screen.findByText('Net pay: ₹22,377.00')).toBeOnTheScreen();
    expect(
      screen.getByText('In words: Twenty-two thousand three hundred seventy-seven rupees only'),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Awaiting review by a chartered accountant/)).toBeOnTheScreen();
    expect(screen.getByText('Provident fund')).toBeOnTheScreen();
    expect(screen.getByText('₹2,280.00')).toBeOnTheScreen();
    expect(screen.getByText('100200300400')).toBeOnTheScreen();
    expect(screen.queryByText(/Attendance-based estimate/)).toBeNull();
  });

  it('steps back a month, and says when a month has no approved payslip', async () => {
    await renderPhone(true);
    await screen.findByText('Net pay: ₹22,377.00');
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText(/^No approved payslip for /)).toBeOnTheScreen();
  });
});
