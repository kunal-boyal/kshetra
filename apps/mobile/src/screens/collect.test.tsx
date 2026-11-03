import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim as claimDevice, migrate, Outbox, Tracking } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { AccountScreen } from './account';
import { CollectScreen } from './collect';
import { MyCollectionsScreen } from './my-collections';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useFocusEffect: () => undefined,
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
// The phone stands at the shop, known to within 12 m.
const mockLocation = { granted: true };
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Highest: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: mockLocation.granted }),
  getBackgroundPermissionsAsync: async () => ({ granted: true }),
  hasStartedLocationUpdatesAsync: async () => false,
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 28.6315, longitude: 77.2167, accuracy: 12 },
    timestamp: Date.now(),
    mocked: false,
  }),
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${ASHA}`;
const SHOP = '01a10000-0000-7000-8000-000000000080';
const SHIFT = '01a10000-0000-7000-8000-0000000000c1';
const TODAY = todayIn('Asia/Kolkata');
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const FIELD = [
  'account.view',
  'shift.use',
  'visit.use',
  'finance.view',
  'collection.record',
] as const;

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function collection(id: string, patch: object = {}) {
  return {
    id,
    number: 'COL-000007',
    accountId: SHOP,
    userId: ASHA,
    collectedOn: TODAY,
    collectedAt: new Date().toISOString(),
    amount: '5000.00',
    mode: 'cash' as const,
    reference: null,
    chequeNumber: null,
    chequeBank: null,
    chequeDate: null,
    status: 'recorded' as const,
    reason: null,
    ...patch,
  };
}

const INVOICES = [
  {
    id: '01a10000-0000-7000-8000-0000000000a1',
    number: 'INV-101',
    date: '2026-08-01',
    dueDate: '2026-08-31',
    amount: '8000.00',
    open: '8000.00',
    daysPastDue: 64,
    cancelled: false,
    settledBy: [],
  },
  {
    id: '01a10000-0000-7000-8000-0000000000a2',
    number: 'INV-102',
    date: '2026-10-20',
    dueDate: '2099-11-19',
    amount: '12000.00',
    open: '12000.00',
    daysPastDue: null,
    cancelled: false,
    settledBy: [],
  },
];

function pulled(collections: object[]): SyncPullResult {
  return {
    entities: {
      users: full([]),
      territories: full([]),
      accounts: full([
        {
          id: SHOP,
          type: 'shop',
          code: 'D-81',
          name: 'Beej Bhandar',
          territoryId: '01a10000-0000-7000-8000-000000000010',
          parentId: null,
          address: {},
          location: { lat: 28.6315, lng: 77.2167 },
          geofenceRadiusM: null,
          locationStatus: 'verified',
          status: 'active',
          segments: [],
          custom: {},
          slots: [],
        },
      ]) as SyncPullResult['entities']['accounts'],
      contacts: full([]),
      items: full([]),
      balances: full([
        {
          id: '01a10000-0000-7000-8000-0000000000b1',
          accountId: SHOP,
          asOf: TODAY,
          outstanding: '20000.00',
          creditLimit: null,
          ageing: {},
        },
      ]),
      collections: full(collections) as SyncPullResult['entities']['collections'],
    },
    cursor: 'c1',
    more: false,
  };
}

function fakeClient(collections: object[], online = true) {
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
    me: jest.fn(async () => ({
      userId: ASHA,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-004',
      name: 'Asha Rao',
      designation: 'executive',
      role: 'field_user',
      scope: 'self',
      permissions: [...FIELD],
      deviceId: null,
      calendarKey: null,
    })),
    syncPull: jest.fn(async () => pulled(collections)),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async (method, path) => {
      if (method === 'GET' && String(path).startsWith(`/v1/accounts/${SHOP}/invoices`)) {
        if (!online) throw new Error('offline');
        return { items: INVOICES, nextCursor: null };
      }
      // Collections wait for a signal, as in a field with none.
      if (method === 'POST') throw new Error('offline');
      return {};
    }),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [
          {
            id: '01a10000-0000-7000-8000-000000000070',
            version: 1,
            key: 'shop',
            name: noun('Shop', 'Shops'),
            icon: 'store',
            active: true,
            parentTypes: [],
            code: { mode: 'manual' },
            fields: [],
            location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: false },
            creation: 'admins',
            slots: [],
            segmentRules: [],
            visitFrequencyNorms: [],
            contacts: false,
          },
        ],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'field_user', scope: 'self', permissions: [...FIELD] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

type Page = 'collect' | 'mine' | 'account';

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page === 'collect') return <CollectScreen accountId={SHOP} />;
  return page === 'mine' ? <MyCollectionsScreen /> : <AccountScreen id={SHOP} />;
}

async function phone() {
  const db = nodeSqlite();
  await migrate(db);
  await claimDevice(db, OWNER);
  return db;
}

async function renderAt(
  page: Page,
  options: { db?: ReturnType<typeof nodeSqlite>; collections?: object[]; online?: boolean } = {},
) {
  const db = options.db ?? (await phone());
  const fake = fakeClient(options.collections ?? [], options.online ?? true);
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

const queued = async (db: ReturnType<typeof nodeSqlite>) =>
  (await new Outbox(db, {}).items(OWNER)).filter((item) => item.kind === 'collection.create');

describe('collecting a payment on the phone (M11, BR-63, D132)', () => {
  it('shows what the shop owes and what the amount settles first, queues it, and shares a receipt', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { db } = await renderAt('collect');
    expect(await screen.findByText('₹20,000.00 outstanding · ₹8,000.00 overdue')).toBeOnTheScreen();
    expect(screen.getByText('INV-101 · ₹8,000.00')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Amount', { exact: false }), '10000');
    expect(
      await screen.findByText('Settles INV-101 (₹8,000.00), INV-102 (₹2,000.00) first.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save ₹10,000.00' }));

    expect(await screen.findByText(/^Saved ₹10,000.00 from Beej Bhandar/)).toBeOnTheScreen();
    const [item] = await queued(db);
    expect(item!.payload).toMatchObject({
      accountId: SHOP,
      amount: '10000',
      mode: 'cash',
      visitId: null,
      photos: [],
      fix: expect.objectContaining({ location: { lat: 28.6315, lng: 77.2167 } }),
    });
    expect(item!.dependsOn ?? []).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: 'Share receipt' }));
    const message = (share.mock.calls[0]![0] as { message: string }).message;
    expect(message).toContain('Received ₹10,000.00 from Beej Bhandar (D-81)');
    expect(message).toContain('paid by Cash');
    expect(message).toContain('Collected by Asha Rao.');
    expect(message).toContain('Awaiting the office’s confirmation.');
    share.mockRestore();
  });

  it('asks for location to record the payment, in words about the payment', async () => {
    mockLocation.granted = false;
    try {
      const { db } = await renderAt('collect');
      await fireEvent.changeText(await screen.findByLabelText('Amount', { exact: false }), '500');
      await fireEvent.press(screen.getByRole('button', { name: 'Save ₹500.00' }));
      expect(await screen.findByText('Allow location to record this payment.')).toBeOnTheScreen();
      expect(await queued(db)).toEqual([]);
    } finally {
      mockLocation.granted = true;
    }
  });

  it('asks a cheque for its number, bank and photo before it saves', async () => {
    const { db } = await renderAt('collect');
    await fireEvent.changeText(await screen.findByLabelText('Amount', { exact: false }), '4500');
    await fireEvent.press(screen.getByRole('radio', { name: 'Cheque' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save ₹4,500.00' }));
    expect(await screen.findByText('Enter the cheque number')).toBeOnTheScreen();
    expect(screen.getByText('Enter the cheque’s bank')).toBeOnTheScreen();
    expect(screen.getByText('Take a photo of the cheque')).toBeOnTheScreen();
    expect(await queued(db)).toEqual([]);
  });

  it('says when cash would pass the day’s limit, counting what was taken here today', async () => {
    await renderAt('collect', {
      collections: [collection('01a10000-0000-7000-8000-0000000000d1', { amount: '190000.00' })],
    });
    await fireEvent.changeText(await screen.findByLabelText('Amount', { exact: false }), '15000');
    expect(
      await screen.findByText(
        'Cash from one account in a day must stay under ₹2,00,000.00. ₹1,90,000.00 in cash taken here today already.',
      ),
    ).toBeOnTheScreen();
    // UPI has no such limit.
    await fireEvent.press(screen.getByRole('radio', { name: 'UPI' }));
    expect(screen.queryByText(/must stay under/)).toBeNull();
  });

  it('works offline from the kept balance, and a collection in a visit waits for its check-in', async () => {
    const db = await phone();
    await db.transaction((tx) =>
      new Tracking(db).open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 3_600_000,
        endsBy: Date.now() + 12 * 3_600_000,
        intervalSeconds: 120,
      }),
    );
    const account = await renderAt('account', { db, online: false });
    await fireEvent.press(await account.view.findByRole('button', { name: 'Check in' }));
    // The account's to-do list offers it with what is owed.
    expect(await screen.findByText('Collect payment')).toBeOnTheScreen();
    expect(screen.getByText('₹20,000.00 outstanding')).toBeOnTheScreen();
    await account.view.unmount();

    await renderAt('collect', { db, online: false });
    await fireEvent.changeText(await screen.findByLabelText('Amount', { exact: false }), '2000');
    await fireEvent.press(screen.getByRole('radio', { name: 'UPI' }));
    await fireEvent.changeText(screen.getByLabelText('Reference', { exact: false }), 'UPI4471');
    await fireEvent.press(screen.getByRole('button', { name: 'Save ₹2,000.00' }));
    await waitFor(async () => expect(await queued(db)).toHaveLength(1));
    const [item] = await queued(db);
    const visitId = (item!.payload as { visitId: string }).visitId;
    expect(visitId).toEqual(expect.any(String));
    expect(item!.dependsOn).toEqual([visitId]);
    expect(item!.payload).toMatchObject({ mode: 'upi', reference: 'UPI4471' });
  });

  it('shows on the account what was collected but isn’t in the books yet', async () => {
    await renderAt('account', {
      collections: [
        collection('01a10000-0000-7000-8000-0000000000d1', { amount: '5000.00' }),
        collection('01a10000-0000-7000-8000-0000000000d2', {
          amount: '3000.00',
          status: 'rejected',
        }),
      ],
    });
    expect(await screen.findByText('Collected, not yet in the books')).toBeOnTheScreen();
    expect(screen.getByText('₹5,000.00')).toBeOnTheScreen();
    expect(screen.getByText('₹15,000.00')).toBeOnTheScreen();
  });
});

describe('my collections (M11, BR-63, D132)', () => {
  it('lists the person’s own with what the office decided and why money was turned down', async () => {
    await renderAt('mine', {
      collections: [
        collection('01a10000-0000-7000-8000-0000000000d1', { status: 'confirmed' }),
        collection('01a10000-0000-7000-8000-0000000000d2', {
          number: 'COL-000008',
          mode: 'cheque',
          chequeNumber: '004512',
          chequeBank: 'Bank of Maharashtra',
          amount: '2500.00',
          status: 'bounced',
          reason: 'Funds insufficient',
        }),
        // Someone else's at an account the person sees: not theirs to list.
        collection('01a10000-0000-7000-8000-0000000000d3', {
          number: 'COL-000009',
          userId: '01a10000-0000-7000-8000-000000000005',
        }),
      ],
    });
    expect(await screen.findByText('Confirmed')).toBeOnTheScreen();
    expect(screen.getByText(/Cheque 004512 · Bank of Maharashtra/)).toBeOnTheScreen();
    expect(screen.getByText('Bounced')).toBeOnTheScreen();
    expect(screen.getByText('Why: Funds insufficient')).toBeOnTheScreen();
    expect(screen.queryByText(/COL-000009/)).toBeNull();
    // Collected this month: the bounced cheque doesn't count.
    expect(screen.getByText('Collected this month')).toBeOnTheScreen();
    expect(screen.getAllByText('₹5,000.00').length).toBeGreaterThanOrEqual(2);
    // Only money that stands can be shared again as a receipt.
    expect(screen.getAllByRole('button', { name: 'Share receipt' })).toHaveLength(1);
  });

  it('says when there are none', async () => {
    await renderAt('mine');
    expect(await screen.findByText('No collections yet')).toBeOnTheScreen();
  });
});
