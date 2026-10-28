import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, Outbox, type SqlDatabase, Visits } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SwitchableModule, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { AccountScreen } from './account';
import { AccountsScreen } from './accounts';
import { NewAccountScreen } from './new-account';
import { repriceRefused } from '../orders';
import { OrderScreen } from './order';
import { PricesScreen } from './prices';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
// The phone stands at Connaught Place, New Delhi, known to within 12 m.
jest.mock('expo-location', () => ({
  Accuracy: { Highest: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 28.6315, longitude: 77.2167, accuracy: 12 },
    timestamp: Date.now(),
  }),
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const USER = '01a10000-0000-7000-8000-000000000004';
const OWNER = `01a10000-0000-7000-8000-000000000001:${USER}`;
const MARKET = '01a10000-0000-7000-8000-000000000010';
const NEAR = '01a10000-0000-7000-8000-000000000080';
const FAR = '01a10000-0000-7000-8000-000000000081';
const UNPLACED = '01a10000-0000-7000-8000-000000000082';
const text = (en: string) => ({ en, hi: en });
const SEED = '01a10000-0000-7000-8000-0000000000b0';
const SPRAY = '01a10000-0000-7000-8000-0000000000b1';
const OLD = '01a10000-0000-7000-8000-0000000000b2';
const STANDARD = '01a10000-0000-7000-8000-0000000000c0';
const JANPATH_LIST = '01a10000-0000-7000-8000-0000000000c1';

function item(id: string, code: string, name: string, active = true) {
  return {
    id,
    code,
    name,
    product: { id: '01a10000-0000-7000-8000-0000000000d0', name: 'Field care' },
    category: null,
    packLabel: null,
    hsn: null,
    taxRate: '18.0000',
    mrp: null,
    baseUnit: 'pack',
    units: [{ key: 'pack', factor: '1.000' }],
    measureType: null,
    measurePerBaseUnit: null,
    custom: {},
    active,
  };
}

function priceList(id: string, name: string, scope: string, targets: string[]) {
  return {
    id,
    name,
    scope,
    targets,
    priority: 0,
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
  };
}

function price(id: string, list: string, itemId: string, amount: string, discount = '0.0000') {
  return { id, priceListId: list, itemId, price: amount, discount, removed: false };
}

const CUSTOMER = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'customer',
  name: { en: { one: 'Customer', other: 'Customers' }, hi: { one: 'ग्राहक', other: 'ग्राहक' } },
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [
    {
      key: 'owner_name',
      type: 'short_text',
      label: text('Owner name'),
      required: false,
      maxLength: 100,
    },
  ],
  location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'field_users_with_approval',
  slots: [
    {
      key: 'executive',
      name: text('Executive'),
      designations: ['executive'],
      required: false,
      priority: 1,
    },
  ],
  segmentRules: [],
  visitFrequencyNorms: [],
  contacts: true,
};

function account(id: string, name: string, location: { lat: number; lng: number } | null) {
  return {
    id,
    type: 'customer',
    code: `C-${id.slice(-2)}`,
    name,
    territoryId: MARKET,
    parentId: null,
    address: {},
    location,
    geofenceRadiusM: null,
    locationStatus: location ? 'verified' : 'unverified',
    status: 'active',
    segments: [],
    custom: {},
    slots: [{ slot: 'executive', userId: USER }],
  };
}

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function pulled(): SyncPullResult {
  return {
    entities: {
      users: full([
        {
          id: USER,
          code: 'SUN-004',
          name: 'Rahul Verma',
          phone: null,
          designation: 'executive',
          role: 'field_user',
          managerId: null,
          status: 'active' as const,
        },
      ]),
      territories: full([
        { id: MARKET, parentId: null, level: 1, code: 'N-DEL', name: 'Delhi Market', active: true },
      ]),
      accounts: full([
        // About 2.4 km away at India Gate, 1 km away, and one nobody has placed.
        account(FAR, 'India Gate Stores', { lat: 28.6129, lng: 77.2295 }),
        account(NEAR, 'Janpath Mart', { lat: 28.6225, lng: 77.2195 }),
        account(UNPLACED, 'Corner Kirana', null),
      ]) as SyncPullResult['entities']['accounts'],
      items: full([
        item(SEED, 'SEED-1', 'Hybrid seed'),
        item(SPRAY, 'SPRAY-1', 'Neem spray'),
        item(OLD, 'OLD-1', 'Old stock', false),
      ]),
      price_lists: full([
        priceList(STANDARD, 'Standard', 'default', []),
        priceList(JANPATH_LIST, 'Janpath terms', 'account', [NEAR]),
      ]) as SyncPullResult['entities']['price_lists'],
      prices: full([
        price('01a10000-0000-7000-8000-0000000000e0', STANDARD, SEED, '400.00', '10.0000'),
        price('01a10000-0000-7000-8000-0000000000e1', STANDARD, SPRAY, '60.00'),
        price('01a10000-0000-7000-8000-0000000000e2', STANDARD, OLD, '10.00'),
        price('01a10000-0000-7000-8000-0000000000e3', JANPATH_LIST, SPRAY, '55.00'),
      ]),
      balances: full([
        {
          id: NEAR,
          accountId: NEAR,
          asOf: '2026-10-15',
          outstanding: '9000.00',
          creditLimit: '10000.00',
          ageing: { d0_30: '6000.00', d181: '3000.00' },
        },
      ]),
      contacts: full([
        {
          id: '01a10000-0000-7000-8000-000000000090',
          accountId: UNPLACED,
          name: 'Meena Shah',
          role: 'Owner',
          phone: '+919876543210',
          email: null,
          active: true,
        },
      ]),
    },
    cursor: 'c1',
    more: false,
  };
}

function fakeClient(modulesOff: SwitchableModule[] = []) {
  const session: SessionState = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const client = {
    session,
    owner: `${TENANT.id}:${USER}`,
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => undefined),
    syncPull: jest.fn(async () => pulled()),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    me: jest.fn(async () => ({
      userId: USER,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-004',
      name: 'Rahul Verma',
      designation: 'executive',
      role: 'field_user',
      scope: 'self',
      permissions: [],
      deviceId: '01a10000-0000-7000-8000-000000000003',
    })),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-2"',
      bundle: {
        version: 1,
        settings: { ...SETTING_DEFAULTS, modulesOff },
        terminology: {},
        designations: [],
        accountTypes: [CUSTOMER],
        access: {
          role: 'field_user',
          scope: 'self',
          permissions: [
            'account.view',
            'account.propose',
            'account.propose_location',
            'order.create',
            'finance.view',
          ],
        },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

type Page =
  | { name: 'list' }
  | { name: 'account'; id: string }
  | { name: 'new' }
  | { name: 'prices'; id: string }
  | { name: 'order'; id: string };

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page.name === 'list') return <AccountsScreen />;
  if (page.name === 'new') return <NewAccountScreen typeKey="customer" />;
  if (page.name === 'prices') return <PricesScreen accountId={page.id} />;
  if (page.name === 'order') return <OrderScreen accountId={page.id} />;
  return <AccountScreen id={page.id} />;
}

async function renderPhone(
  page: Page,
  db: SqlDatabase = nodeSqlite(),
  modulesOff: SwitchableModule[] = [],
) {
  await migrate(db);
  const fake = fakeClient(modulesOff);
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
            <Shown page={page} />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return fake.client;
}

describe('accounts on the phone', () => {
  it('lists the places the phone keeps, nearest first, and finds them by name or code', async () => {
    await renderPhone({ name: 'list' });
    await screen.findAllByRole('button', { name: /Mart|Stores|Kirana/ });
    const labels = () =>
      screen
        .getAllByText(/^(Janpath Mart|India Gate Stores|Corner Kirana)$/)
        .map((node) => node.props.children);
    await waitFor(() =>
      expect(labels()).toEqual(['Janpath Mart', 'India Gate Stores', 'Corner Kirana']),
    );
    expect(screen.getByText('C-80 · 1 km away')).toBeOnTheScreen();
    expect(screen.getByText('C-81 · 2.4 km away')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Search'), 'c-82');
    await waitFor(() => expect(labels()).toEqual(['Corner Kirana']));
    await fireEvent.press(screen.getByRole('button', { name: /Corner Kirana/ }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/accounts/[id]',
      params: { id: UNPLACED },
    });
  });

  it('proposes where a place is from a fix of 50 m or better, and sends it', async () => {
    const client = await renderPhone({ name: 'account', id: UNPLACED });
    expect(await screen.findByText('Corner Kirana')).toBeOnTheScreen();
    expect(screen.getByText('Meena Shah')).toBeOnTheScreen();
    // In the details as the contact, and in the contacts list.
    expect(screen.getAllByText(/^Rahul Verma/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Find my location' }));
    expect(await screen.findByText('Your location is known to within 12 m.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Propose this location' }));
    expect(
      await screen.findByText('Location proposed. Your manager decides it.'),
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'POST',
        `/v1/accounts/${UNPLACED}/location-proposals`,
        expect.anything(),
        {
          body: expect.objectContaining({
            id: expect.any(String),
            lat: 28.6315,
            lng: 77.2167,
            accuracy: 12,
            capturedAt: expect.any(String),
            proposedAt: expect.any(String),
          }),
        },
      ),
    );
  });

  it('proposes a new place with its own fields, kept on the phone as waiting and sent for approval', async () => {
    const db = nodeSqlite();
    const client = await renderPhone({ name: 'new' }, db);
    expect(await screen.findByText('Propose a new Customer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Send for approval' }));
    expect(screen.getByText('Fill in the name')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(/^Name/), 'Naya Bazaar Store');
    await fireEvent.changeText(screen.getByLabelText(/^Code/), 'C-99');
    await fireEvent.press(await screen.findByRole('radio', { name: /Delhi Market/ }));
    // The type's own fields are filled here too.
    await fireEvent.changeText(screen.getByLabelText('Owner name'), '  Meena Shah ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith('POST', '/v1/accounts', expect.anything(), {
        body: {
          id: expect.any(String),
          type: 'customer',
          code: 'C-99',
          name: 'Naya Bazaar Store',
          territoryId: MARKET,
          custom: { owner_name: 'Meena Shah' },
        },
      }),
    );
  });
});

describe('prices on the phone (spec 5.11, D77)', () => {
  it('opens what an account pays from the account', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'See what it pays' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/prices/[accountId]',
      params: { accountId: NEAR },
    });
  });

  it("works out an account's prices offline: its own list first, then the default", async () => {
    await renderPhone({ name: 'prices', id: NEAR });
    expect(await screen.findByText('Hybrid seed · ₹360.00')).toBeOnTheScreen();
    expect(screen.getByText('SEED-1 · ₹400.00 less 10% · Standard')).toBeOnTheScreen();
    expect(screen.getByText('Neem spray · ₹55.00')).toBeOnTheScreen();
    expect(screen.getByText('SPRAY-1 · Janpath terms')).toBeOnTheScreen();
    expect(screen.queryByText(/Old stock/)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Find by item code or name'), 'spray');
    await waitFor(() => expect(screen.queryByText(/Hybrid seed/)).toBeNull());
  });

  it('prices another account from the default list only', async () => {
    await renderPhone({ name: 'prices', id: FAR });
    expect(await screen.findByText('Neem spray · ₹60.00')).toBeOnTheScreen();
    expect(screen.getByText('SPRAY-1 · Standard')).toBeOnTheScreen();
  });
});

describe('orders on the phone (M10, D78)', () => {
  it('opens a new order from the account', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'New order' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[accountId]',
      params: { accountId: NEAR },
    });
  });

  it('prices the cart as the server will and sends what it showed, with a fix', async () => {
    const client = await renderPhone({ name: 'order', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: /Hybrid seed · ₹360.00/ }));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '24');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    // FX-07: 24 packs at 360.00 with 18% tax.
    expect(await screen.findByText('Hybrid seed · ₹10,195.20')).toBeOnTheScreen();
    expect(screen.getByText('CGST: ₹777.60')).toBeOnTheScreen();
    // 9,000 owed and a 10,000 limit: this order goes over it.
    expect(
      screen.getByText(/past its credit limit, so it may need another approval/),
    ).toBeOnTheScreen();
    const place = screen.getByRole('button', { name: 'Place the order' });
    await waitFor(() => expect(place).toBeEnabled());
    await fireEvent.press(place);
    await waitFor(() =>
      expect(
        client.request.mock.calls.some(
          ([method, path]) => method === 'POST' && path === '/v1/orders',
        ),
      ).toBe(true),
    );
    const [, , , options] = client.request.mock.calls.find(([, path]) => path === '/v1/orders')!;
    expect((options as { body: unknown }).body).toMatchObject({
      accountId: NEAR,
      visitId: null,
      lines: [
        {
          itemId: SEED,
          unitKey: 'pack',
          quantity: '24',
          quoted: {
            listId: STANDARD,
            price: '400.00',
            discount: '10.0000',
            taxRate: '18.0000',
            factor: '1.000',
          },
        },
      ],
      fix: { location: { lat: 28.6315, lng: 77.2167 }, accuracy: 12 },
    });
  });

  it('prices a refused order again from what the phone keeps now', async () => {
    const db = nodeSqlite();
    await renderPhone({ name: 'prices', id: NEAR }, db);
    await screen.findByText('Neem spray · ₹55.00');
    const outbox = new Outbox(db, {});
    const body = {
      id: '01a10000-0000-7000-8000-0000000000f9',
      accountId: NEAR,
      visitId: null,
      lines: [
        {
          itemId: SPRAY,
          unitKey: 'pack',
          quantity: '1',
          quoted: { listId: STANDARD, price: '60.00', discount: '0', taxRate: '18', factor: '1' },
        },
      ],
      note: null,
      photos: [],
      fix: null,
      placedAt: new Date().toISOString(),
    };
    await outbox.enqueue(db, { id: body.id, owner: OWNER, kind: 'order.place', payload: body });
    await db.run(
      "UPDATE outbox SET state = 'parked', last_error_code = 'PRICE_CHANGED' WHERE id = ?",
      [body.id],
    );
    expect(
      await repriceRefused(
        { db, outbox, visits: new Visits(db) },
        body.id,
        body,
        'per_unit_first',
        '2026-10-24',
      ),
    ).toBe(true);
    const [item] = await outbox.items(OWNER);
    expect(item).toMatchObject({ state: 'queued', lastErrorCode: null });
    expect((item!.payload as typeof body).lines[0]!.quoted).toEqual({
      listId: JANPATH_LIST,
      price: '55.00',
      discount: '0.0000',
      taxRate: '18.0000',
      factor: '1.000',
    });
  });
});

describe('what an account owes on the phone (M11, D79)', () => {
  it('shows the latest balance, the credit left and its ageing', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    expect(await screen.findByText('What it owes')).toBeOnTheScreen();
    expect(screen.getByText('₹9,000.00')).toBeOnTheScreen();
    expect(screen.getByText('Outstanding as of 15 Oct 2026')).toBeOnTheScreen();
    expect(screen.getByText('₹1,000.00 of credit left')).toBeOnTheScreen();
    expect(screen.getByText('Over 180 days')).toBeOnTheScreen();
  });

  it('shows nothing owed for an account without a balance', async () => {
    await renderPhone({ name: 'account', id: FAR });
    await screen.findByText('India Gate Stores');
    expect(screen.queryByText('What it owes')).toBeNull();
  });
});

describe('modules switched off on the phone (M2, spec 5.13, D64)', () => {
  it('hides prices, orders and what an account owes', async () => {
    await renderPhone({ name: 'account', id: NEAR }, nodeSqlite(), ['orders', 'account_finance']);
    await screen.findByText('Janpath Mart');
    expect(screen.queryByText('What it owes')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See what it pays' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New order' })).toBeNull();
  });

  it('keeps orders while only finance is off', async () => {
    await renderPhone({ name: 'account', id: NEAR }, nodeSqlite(), ['account_finance']);
    expect(await screen.findByRole('button', { name: 'New order' })).toBeOnTheScreen();
    expect(screen.queryByText('What it owes')).toBeNull();
  });
});
