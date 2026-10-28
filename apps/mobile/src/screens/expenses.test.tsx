import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim as claimDevice, migrate, Outbox, Tracking } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { ExpensesScreen } from './expenses';
import { NewClaimScreen } from './new-claim';

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
const TODAY = todayIn('Asia/Kolkata');
const PERIOD = TODAY.slice(0, 7);

const named = (en: string) => ({ en, hi: en });
const POLICIES = [
  {
    key: 'fuel',
    name: named('Fuel'),
    category: 'travel',
    calculation: 'per_km',
    rate: { flat: '8' },
    caps: {},
    receiptRequired: false,
    odometerPhotosRequired: true,
    active: true,
    version: 1,
    validFrom: '2000-01-01',
  },
  {
    key: 'da',
    name: named('Daily allowance'),
    category: 'daily_allowance',
    calculation: 'per_day',
    rate: { byDesignation: { executive: '500' } },
    caps: { perClaim: '1200' },
    receiptRequired: false,
    odometerPhotosRequired: false,
    active: true,
    version: 1,
    validFrom: '2000-01-01',
  },
  {
    key: 'meals',
    name: named('Meals'),
    category: 'other',
    calculation: 'actual',
    caps: {},
    receiptRequired: true,
    odometerPhotosRequired: false,
    active: true,
    version: 1,
    validFrom: '2000-01-01',
  },
];
const claim = (id: string, patch: object) => ({
  id,
  userId: ASHA,
  user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
  policy: 'meals',
  policyVersion: 1,
  expenseDate: `${PERIOD}-01`,
  description: 'Team lunch',
  quantity: null,
  rate: null,
  odometerOpen: null,
  odometerClose: null,
  shiftId: null,
  billAmount: '412.50',
  calculated: '412.50',
  amount: '412.50',
  capped: false,
  receipts: [],
  odometerPhotos: [],
  flags: [],
  state: 'approved',
  approval: null,
  paidAt: null,
  paymentReference: null,
  createdAt: `${PERIOD}-01T09:00:00.000Z`,
  decidedAt: null,
  ...patch,
});
const CLAIMS = [
  claim('01a10000-0000-7000-8000-0000000000e1', {}),
  claim('01a10000-0000-7000-8000-0000000000e2', {
    policy: 'da',
    description: 'Tour',
    quantity: '3.000',
    rate: '500.00',
    billAmount: null,
    calculated: '1500.00',
    amount: '1200.00',
    capped: true,
    flags: ['receipt_missing', 'capped'],
    state: 'pending',
  }),
];

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
        permissions: ['expense.claim'],
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
      if (method === 'GET' && url === '/v1/expense-policies') return { items: POLICIES };
      if (method === 'GET' && url.startsWith('/v1/expense-claims?')) {
        return { items: url.includes(`period=${PERIOD}`) ? CLAIMS : [], nextCursor: null };
      }
      // Claims wait for a signal, as in a field with none.
      if (method === 'POST' && url === '/v1/approvals/preview') {
        return {
          blocked: false,
          steps: [
            {
              approvers: [{ id: OWNER.split(':')[1]!, code: 'SUN-003', name: 'Meena Shah' }],
              escalated: false,
              fallback: false,
            },
          ],
        };
      }
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
          access: { role: 'field_user', scope: 'self', permissions: ['expense.claim'] },
        },
      };
    }),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'list' | 'new' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'list' ? <ExpensesScreen /> : <NewClaimScreen />;
}

async function renderPhone(
  page: 'list' | 'new',
  options: { offline?: boolean; db?: ReturnType<typeof nodeSqlite> } = {},
) {
  const fake = fakeClient(options.offline);
  const db = options.db ?? nodeSqlite();
  if (!options.db) {
    await migrate(db);
    await claimDevice(db, OWNER);
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

describe('expenses on the phone (M12, spec 8.1)', () => {
  it('shows the month’s claims with their amounts, caps, flags and state', async () => {
    await renderPhone('list');
    expect(await screen.findByText('Team lunch', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('₹412.50')).toBeOnTheScreen();
    expect(screen.getByText('Approved')).toBeOnTheScreen();
    expect(screen.getByText('₹1,200.00')).toBeOnTheScreen();
    expect(screen.getByText('Capped from ₹1,500.00')).toBeOnTheScreen();
    expect(screen.getByText('Needs a receipt before approval')).toBeOnTheScreen();
    // The month claims both, exact as paise.
    expect(screen.getByText('Claimed this month')).toBeOnTheScreen();
    expect(screen.getByText('₹1,612.50')).toBeOnTheScreen();
    // Only a waiting claim takes another receipt.
    expect(screen.getAllByRole('button', { name: 'Add a receipt' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Claim an expense' }));
    expect(router.push).toHaveBeenCalledWith('/expenses/new');
  });

  it('works out the amount live, says what the server would refuse, and queues the claim', async () => {
    const { db } = await renderPhone('new');
    // FX-21 on the phone, held up until both readings are photographed.
    await fireEvent.changeText(await screen.findByLabelText(/^Opening reading/), '1000');
    await fireEvent.changeText(screen.getByLabelText(/^Closing reading/), '1042');
    expect(await screen.findByText('Comes to ₹336.00')).toBeOnTheScreen();
    expect(screen.getByText('Add photos of the opening and closing readings')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Send the claim/ })).toBeDisabled();

    // FX-22: three days at the designation's 500, capped at 1,200 a claim.
    await fireEvent.press(screen.getByRole('radio', { name: /Daily allowance/ }));
    await fireEvent.changeText(screen.getByLabelText(/^Days/), '3');
    expect(await screen.findByText('Comes to ₹1,200.00')).toBeOnTheScreen();
    expect(screen.getByText('Capped from ₹1,500.00')).toBeOnTheScreen();
    // Who decides it, routed with its amount and that it was capped.
    expect(await screen.findByText('After you send it')).toBeOnTheScreen();
    expect(await screen.findByText('Meena Shah')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send the claim · ₹1,200.00' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Description/), 'Tour of the north');
    await fireEvent.press(screen.getByRole('button', { name: /^Send the claim/ }));
    await waitFor(async () => {
      const [item] = await new Outbox(db, {}).items(OWNER);
      expect(item).toMatchObject({
        kind: 'expense_claim.create',
        payload: {
          policy: 'da',
          expenseDate: TODAY,
          description: 'Tour of the north',
          days: '3',
          receiptIds: [],
          odometerPhotoIds: [],
        },
      });
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('begins a fuel claim from the day’s shift readings and photos (decision D99)', async () => {
    const db = nodeSqlite();
    await migrate(db);
    await claimDevice(db, OWNER);
    const shiftId = '01a10000-0000-7000-8000-0000000000d1';
    const tracking = new Tracking(db);
    await db.transaction(async (tx) => {
      await tracking.openOdometer(tx, OWNER, { shiftId, date: TODAY, reading: '12045' });
      await tracking.closeOdometer(tx, OWNER, shiftId, '12098.5', 'punch-out-1');
    });
    await renderPhone('new', { db });
    expect(await screen.findByText(/^From your shift: 12045 to 12098.5 km/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Opening reading/)).toHaveDisplayValue('12045');
    // 53.5 km at 8, and no photos asked for: the shift's go with it.
    expect(await screen.findByText('Comes to ₹428.00')).toBeOnTheScreen();
    expect(screen.queryByText('Add photos of the opening and closing readings')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText(/^Description/), 'Beat and back');
    await fireEvent.press(screen.getByRole('button', { name: /^Send the claim/ }));
    await waitFor(async () => {
      const [item] = await new Outbox(db, {}).items(OWNER);
      expect(item).toMatchObject({
        kind: 'expense_claim.create',
        payload: {
          policy: 'fuel',
          shiftId,
          odometerOpen: '12045',
          odometerClose: '12098.5',
          odometerPhotoIds: [],
        },
        // It waits for the punch-out that carries the closing reading.
        dependsOn: ['punch-out-1'],
      });
    });
  });

  it('says when a policy needs a receipt, and shows the month read last offline', async () => {
    const first = await renderPhone('new');
    await fireEvent.press(await screen.findByRole('radio', { name: /Meals/ }));
    expect(screen.getByText(/needs a receipt before anyone can approve/)).toBeOnTheScreen();
    await first.view.unmount();

    const list = await renderPhone('list');
    expect(await screen.findByText('₹412.50')).toBeOnTheScreen();
    await list.view.unmount();
    await renderPhone('list', { offline: true, db: list.db });
    expect(await screen.findByText('₹412.50')).toBeOnTheScreen();
    expect(screen.getByText(/^As of /)).toBeOnTheScreen();
  });
});
