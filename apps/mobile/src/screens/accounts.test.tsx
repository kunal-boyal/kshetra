import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, Outbox, type SqlDatabase, Visits } from '@thelamp/api-client/sync';
import {
  previousPeriod,
  SETTING_DEFAULTS,
  shiftPeriod,
  type SwitchableModule,
  type SyncPullResult,
  todayIn,
} from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { BackHandler } from 'react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { AccountScreen } from './account';
import { AccountsScreen } from './accounts';
import { NewAccountScreen } from './new-account';
import { repriceRefused, stepQuantity } from '../orders';
import { OrderScreen } from './order';
import { PricesScreen } from './prices';
import { forecastOf } from '../forecasts';
import { ForecastScreen } from './forecast';
import { SellThroughScreen } from './sell-through';
import { stockOf } from '../stock';
import { StockCountScreen } from './stock-count';

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
// A distributor that holds stock, and a retailer it supplies (BR-62, D130).
const SUPPLIER = '01a10000-0000-7000-8000-000000000083';
const RETAILER = '01a10000-0000-7000-8000-000000000084';
const text = (en: string) => ({ en, hi: en });
const SEED = '01a10000-0000-7000-8000-0000000000b0';
const SPRAY = '01a10000-0000-7000-8000-0000000000b1';
const OLD = '01a10000-0000-7000-8000-0000000000b2';
const STANDARD = '01a10000-0000-7000-8000-0000000000c0';
const JANPATH_LIST = '01a10000-0000-7000-8000-0000000000c1';

function item(
  id: string,
  code: string,
  name: string,
  active = true,
  extra: {
    category?: { id: string; name: string };
    units?: { key: string; factor: string }[];
  } = {},
) {
  return {
    id,
    code,
    name,
    product: { id: '01a10000-0000-7000-8000-0000000000d0', name: 'Field care' },
    category: extra.category ?? null,
    packLabel: null,
    hsn: null,
    taxRate: '18.0000',
    mrp: null,
    baseUnit: 'pack',
    units: extra.units ?? [{ key: 'pack', factor: '1.000' }],
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
  sellThrough: true,
};

const DISTRIBUTOR = {
  ...CUSTOMER,
  id: '01a10000-0000-7000-8000-000000000071',
  key: 'distributor',
  name: {
    en: { one: 'Distributor', other: 'Distributors' },
    hi: { one: 'वितरक', other: 'वितरक' },
  },
  contacts: false,
  sellThrough: false,
  keepsStock: true,
};

function account(
  id: string,
  name: string,
  location: { lat: number; lng: number } | null,
  extra: { type?: string; parentId?: string } = {},
) {
  return {
    id,
    type: extra.type ?? 'customer',
    code: `C-${id.slice(-2)}`,
    name,
    territoryId: MARKET,
    parentId: extra.parentId ?? null,
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
        account(SUPPLIER, 'Kisan Traders', null, { type: 'distributor' }),
        account(RETAILER, 'Ganesh Agro', null, { parentId: SUPPLIER }),
      ]) as SyncPullResult['entities']['accounts'],
      items: full([
        item(SEED, 'SEED-1', 'Hybrid seed', true, {
          category: { id: '01a10000-0000-7000-8000-0000000000d1', name: 'Seeds' },
          units: [
            { key: 'pack', factor: '1.000' },
            { key: 'case', factor: '10.000' },
          ],
        }),
        item(SPRAY, 'SPRAY-1', 'Neem spray', true, {
          category: { id: '01a10000-0000-7000-8000-0000000000d2', name: 'Sprays' },
        }),
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
        {
          id: FAR,
          accountId: FAR,
          asOf: '2026-10-15',
          outstanding: '9000.00',
          creditLimit: '50000.00',
          ageing: { d0_30: '9000.00' },
        },
      ]) as SyncPullResult['entities']['balances'],
      // Last month's statement at Janpath Mart: 40 seed packs left (BR-53).
      sell_through: full([
        {
          id: '01a10000-0000-7000-8000-0000000000f0',
          accountId: NEAR,
          period: previousPeriod(todayIn(SETTING_DEFAULTS.timezone).slice(0, 7)),
          version: 1,
          recordedAt: '2026-10-28T06:00:00.000Z',
          value: '14400.00',
          lines: [
            {
              itemId: SEED,
              opening: '0',
              received: '80',
              returned: '0',
              closing: '40',
              sold: '40',
              flags: [],
            },
          ],
        },
      ]),
      // One spray free for every ten; a percentage off that has ended (BR-55).
      schemes: full([
        {
          id: '01a10000-0000-7000-8000-0000000000d8',
          key: 'ten_plus_one',
          name: { en: 'Ten plus one', hi: 'दस पर एक' },
          kind: 'free_goods',
          rule: { buy: '10', get: '1' },
          itemIds: [SPRAY],
          categoryIds: [],
          accountTypeKeys: [],
          territoryIds: [],
          validFrom: '2026-01-01',
          validTo: null,
          active: true,
        },
        {
          id: '01a10000-0000-7000-8000-0000000000d9',
          key: 'ended',
          name: { en: 'Ended', hi: 'Ended' },
          kind: 'percentage',
          rule: { percent: '50' },
          itemIds: [],
          categoryIds: [],
          accountTypeKeys: [],
          territoryIds: [],
          validFrom: '2026-01-01',
          validTo: '2026-01-31',
          active: true,
        },
      ]),
      // Next month's forecast at Janpath Mart: 120 seed packs (BR-54).
      forecasts: full([
        {
          id: '01a10000-0000-7000-8000-0000000000f8',
          accountId: NEAR,
          period: shiftPeriod(todayIn(SETTING_DEFAULTS.timezone).slice(0, 7), 1),
          version: 1,
          recordedAt: '2026-11-01T06:00:00.000Z',
          lines: [{ itemId: SEED, quantity: '120' }],
        },
      ]),
      // What Kisan Traders holds: 30 seed packs, and 2 sprays below zero (BR-62).
      stock: full([
        {
          id: SUPPLIER,
          accountId: SUPPLIER,
          items: [
            { itemId: SEED, onHand: '30', countedOn: '2026-10-30' },
            { itemId: SPRAY, onHand: '-2', countedOn: null },
          ],
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
    // An account's open invoices are read online (D121); everything else answers empty.
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async (...args: unknown[]) =>
      String(args[1]).startsWith(`/v1/accounts/${NEAR}/invoices`)
        ? {
            items: [
              {
                id: '01a10000-0000-7000-8000-0000000000c1',
                number: 'INV-2041',
                date: '2026-09-01',
                dueDate: '2026-10-01',
                amount: '5000.00',
                open: '3000.00',
                daysPastDue: 31,
                cancelled: false,
                settledBy: [],
              },
            ],
            nextCursor: null,
          }
        : {},
    ),
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
        accountTypes: [CUSTOMER, DISTRIBUTOR],
        access: {
          role: 'field_user',
          scope: 'self',
          permissions: [
            'account.view',
            'account.propose',
            'account.propose_location',
            'order.create',
            'finance.view',
            'sell_through.record',
            'forecast.record',
            'stock.view',
            'stock.count',
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
  | { name: 'order'; id: string }
  | { name: 'sell_through'; id: string }
  | { name: 'forecast'; id: string }
  | { name: 'stock_count'; id: string };

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page.name === 'list') return <AccountsScreen />;
  if (page.name === 'new') return <NewAccountScreen typeKey="customer" />;
  if (page.name === 'prices') return <PricesScreen accountId={page.id} />;
  if (page.name === 'order') return <OrderScreen accountId={page.id} />;
  if (page.name === 'sell_through') return <SellThroughScreen accountId={page.id} />;
  if (page.name === 'forecast') return <ForecastScreen accountId={page.id} />;
  if (page.name === 'stock_count') return <StockCountScreen accountId={page.id} />;
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
    expect(screen.getByText('C-80 · Customer · 1 km away')).toBeOnTheScreen();
    expect(screen.getByText('C-81 · Customer · 2.4 km away')).toBeOnTheScreen();

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
    await fireEvent.press(await screen.findByRole('button', { name: 'More Hybrid seed' }));
    await fireEvent.press(screen.getByRole('button', { name: 'More Hybrid seed' }));
    // The exact entry, from the quantity, for a count the stepper would take long to reach.
    await fireEvent.press(screen.getByRole('button', { name: /^Quantity of Hybrid seed, 2 pack/ }));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '24');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    // FX-07: 24 packs at 360.00 with 18% tax; the cart bar shows the sum before tax.
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Review: 1 item, ₹8,640.00 + GST' }),
    );
    expect(screen.getByText('Review the order')).toBeOnTheScreen();
    expect(screen.getByText('24 pack × ₹360.00 · GST 18%')).toBeOnTheScreen();
    expect(screen.getAllByText('₹8,640.00')).toHaveLength(2);
    expect(screen.getAllByText('₹777.60')).toHaveLength(2);
    expect(screen.getByText('₹10,195.20')).toBeOnTheScreen();
    // 9,000 owed and a 10,000 limit: this order goes over it.
    expect(
      screen.getByText(/past its credit limit, so it may need another approval/),
    ).toBeOnTheScreen();
    const place = screen.getByRole('button', { name: 'Place the order · ₹10,195.20' });
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

  it('steps a line by one in its unit, out of the cart below one', async () => {
    expect(stepQuantity('2.5', 1)).toBe('3.5');
    expect(stepQuantity('2.5', -1)).toBe('1.5');
    expect(stepQuantity('0.5', -1)).toBeNull();
    expect(stepQuantity('9', 1)).toBe('10');

    await renderPhone({ name: 'order', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'More Neem spray' }));
    expect(await screen.findByRole('button', { name: /^Review: 1 item/ })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Fewer Neem spray' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Review:/ })).toBeNull());

    // In another unit, the stepper counts cases and the row says so.
    await fireEvent.press(screen.getByRole('button', { name: /^Quantity of Hybrid seed, 0/ }));
    await fireEvent.press(screen.getByRole('radio', { name: /case/ }));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '2.5');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'More Hybrid seed' }));
    expect(screen.getByText('3.5')).toBeOnTheScreen();
    expect(screen.getByText('₹360.00/pack · case')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Review: 1 item/ }));
    expect(screen.getByText('3.5 case = 35 pack × ₹360.00 · GST 18%')).toBeOnTheScreen();
  });

  it('narrows the items by category and search together, and says when nothing matches', async () => {
    await renderPhone({ name: 'order', id: NEAR });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Sprays' }));
    expect(screen.getByText('Neem spray')).toBeOnTheScreen();
    expect(screen.queryByText('Hybrid seed')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search items or codes'), 'seed');
    expect(screen.getByText('No item matches. Try another name or code.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Hybrid seed')).toBeOnTheScreen();
    expect(screen.queryByText('Neem spray')).toBeNull();
  });

  it('says how much credit was free, and keeps the cart going back to the items', async () => {
    const back = jest.spyOn(BackHandler, 'addEventListener');
    await renderPhone({ name: 'order', id: FAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'More Neem spray' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Review: 1 item/ }));
    expect(
      screen.getByText(
        'Within credit: ₹41,000.00 of the ₹50,000.00 limit was free before this order.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the items' }));
    expect(screen.getByRole('button', { name: /^Review: 1 item/ })).toBeOnTheScreen();

    // Android's back button does the same while reviewing.
    await fireEvent.press(screen.getByRole('button', { name: /^Review: 1 item/ }));
    const [, onBack] = back.mock.calls.at(-1)!;
    await act(async () => {
      expect((onBack as () => boolean)()).toBe(true);
    });
    expect(screen.getByRole('button', { name: /^Review: 1 item/ })).toBeOnTheScreen();
    back.mockRestore();
  });

  it('says nothing of credit where the account has no limit', async () => {
    await renderPhone({ name: 'order', id: UNPLACED });
    await fireEvent.press(await screen.findByRole('button', { name: 'More Neem spray' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Review: 1 item/ }));
    expect(screen.getByText('Review the order')).toBeOnTheScreen();
    expect(screen.queryByText(/credit/)).toBeNull();
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
          quoted: {
            listId: STANDARD,
            price: '60.00',
            discount: '0',
            taxRate: '18',
            factor: '1',
            scheme: null,
          },
        },
      ],
      free: [],
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
      scheme: null,
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
    // The open invoices, read online, to collect against (D121).
    expect(await screen.findByText('Open invoices')).toBeOnTheScreen();
    expect(screen.getByText('INV-2041 · ₹3,000.00')).toBeOnTheScreen();
    expect(screen.getByText('31 days late')).toBeOnTheScreen();
  });

  it('shows nothing owed for an account without a balance', async () => {
    await renderPhone({ name: 'account', id: UNPLACED });
    await screen.findByText('Corner Kirana');
    expect(screen.queryByText('What it owes')).toBeNull();
  });
});

describe('sell-through on the phone (BR-53, D124)', () => {
  it('opens the stock statement from the account', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'Record sell-through' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sell-through/[accountId]',
      params: { accountId: NEAR },
    });
  });

  it('carries last month’s closing, works out what sold, and queues the save', async () => {
    const db = nodeSqlite();
    await renderPhone({ name: 'sell_through', id: NEAR }, db);
    expect(await screen.findByText('SEED-1 · Opening 40')).toBeOnTheScreen();
    // The item with last month's closing comes first.
    await fireEvent.changeText(screen.getAllByLabelText('Received')[0]!, '100');
    await fireEvent.changeText(screen.getAllByLabelText('Returned')[0]!, '5');
    await fireEvent.changeText(screen.getAllByLabelText('Closing')[0]!, '60');
    expect(await screen.findByText('Sold through 75')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved. It uploads when there is a signal.')).toBeOnTheScreen();
    const [queued] = (await new Outbox(db, {}).items(OWNER)).filter(
      (entry) => entry.kind === 'sell_through.save',
    );
    expect(queued?.payload).toMatchObject({
      accountId: NEAR,
      period: todayIn(SETTING_DEFAULTS.timezone).slice(0, 7),
      body: { lines: [{ itemId: SEED, received: '100', returned: '5', closing: '60' }] },
    });
  });

  it('flags a closing above what the stock explains, before saving', async () => {
    await renderPhone({ name: 'sell_through', id: NEAR });
    await screen.findByText('SEED-1 · Opening 40');
    await fireEvent.changeText(screen.getAllByLabelText('Closing')[0]!, '55');
    expect(await screen.findByText('Sold through -15')).toBeOnTheScreen();
    expect(screen.getByText('Sold below zero')).toBeOnTheScreen();
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

describe('forecasts on the phone (BR-54, D126)', () => {
  const NEXT = shiftPeriod(todayIn(SETTING_DEFAULTS.timezone).slice(0, 7), 1);

  it('opens the forecast from the account', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'Forecast by item' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/forecast/[accountId]',
      params: { accountId: NEAR },
    });
  });

  it('shows next month’s forecast, and queues a change as a new version', async () => {
    const db = nodeSqlite();
    await renderPhone({ name: 'forecast', id: NEAR }, db);
    expect(await screen.findByText(/SEED-1 · 120/)).toBeOnTheScreen();
    expect(screen.getByText('Open until the month begins')).toBeOnTheScreen();
    const [field] = await screen.findAllByLabelText(/^Quantity of /);
    await fireEvent.changeText(field!, '150');
    await fireEvent.press(screen.getByRole('button', { name: 'Save the forecast' }));
    expect(await screen.findByText('Saved. It uploads when there is a signal.')).toBeOnTheScreen();
    const [queued] = (await new Outbox(db, {}).items(OWNER)).filter(
      (entry) => entry.kind === 'forecast.save',
    );
    expect(queued?.payload).toMatchObject({
      accountId: NEAR,
      period: NEXT,
      body: { id: queued?.id, lines: [{ itemId: SEED, quantity: '150' }] },
    });
  });

  it('lays saves still queued over what was synced, 0 taking an item out', () => {
    const synced = [
      {
        id: '01a10000-0000-7000-8000-0000000000f8',
        accountId: NEAR,
        period: NEXT,
        version: 1,
        recordedAt: '2026-11-01T06:00:00.000Z',
        lines: [
          { itemId: SEED, quantity: '120' },
          { itemId: 'other', quantity: '10' },
        ],
      },
    ];
    const queued = [
      {
        accountId: NEAR,
        period: NEXT,
        body: { id: 'a', lines: [{ itemId: SEED, quantity: '150' }] },
      },
      {
        accountId: NEAR,
        period: NEXT,
        body: { id: 'b', lines: [{ itemId: 'other', quantity: '0' }] },
      },
    ];
    const forecast = forecastOf(synced, queued, NEAR, NEXT);
    expect([...forecast.quantities]).toEqual([[SEED, '150']]);
    expect(forecast.waiting).toBe(2);
  });

  it('shows this month locked, read only', async () => {
    await renderPhone({ name: 'forecast', id: NEAR });
    const months = await screen.findAllByRole('radio');
    await fireEvent.press(months[0]!);
    expect(await screen.findByText('Locked')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Save the forecast' })).toBeNull();
    expect(screen.queryAllByLabelText(/^Quantity of /)).toEqual([]);
  });
});

describe('schemes on the phone (BR-55, D127)', () => {
  it('applies the scheme offline, shows the goods given free, and sends what it showed', async () => {
    const client = await renderPhone({ name: 'order', id: NEAR });
    await fireEvent.press(await screen.findByRole('button', { name: 'More Neem spray' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Quantity of Neem spray, 1 pack/ }));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Review: 1 item/ }));
    // 20 sprays: 2 free; the ended 50% never applies.
    expect(screen.getByText(/Scheme: Ten plus one/)).toBeOnTheScreen();
    expect(screen.getByText(/2 .* of Neem spray free/)).toBeOnTheScreen();
    const place = screen.getByRole('button', { name: /^Place the order/ });
    await waitFor(() => expect(place).toBeEnabled());
    await fireEvent.press(place);
    await waitFor(() =>
      expect(client.request.mock.calls.some(([, path]) => path === '/v1/orders')).toBe(true),
    );
    const [, , , options] = client.request.mock.calls.find(([, path]) => path === '/v1/orders')!;
    expect((options as { body: unknown }).body).toMatchObject({
      lines: [{ itemId: SPRAY, quoted: { scheme: { key: 'ten_plus_one', discount: '0.00' } } }],
      free: [{ itemId: SPRAY, baseUnits: '2.000', ofItemId: SPRAY }],
    });
  });
});

describe('distributors’ stock on the phone (BR-62, D130)', () => {
  it('shows what an account holds, below zero too, and opens the count', async () => {
    await renderPhone({ name: 'account', id: SUPPLIER });
    expect(await screen.findByText('Hybrid seed')).toBeOnTheScreen();
    expect(screen.getByText('30 pack')).toBeOnTheScreen();
    expect(screen.getByText('-2 pack')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Count stock' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/stock-count/[accountId]',
      params: { accountId: SUPPLIER },
    });
  });

  it('shows no stock where the account type holds none, or the module is off', async () => {
    await renderPhone({ name: 'account', id: NEAR });
    await screen.findByText('Janpath Mart');
    expect(screen.queryByRole('button', { name: 'Count stock' })).toBeNull();
    screen.unmount();
    await renderPhone({ name: 'account', id: SUPPLIER }, nodeSqlite(), ['inventory']);
    await screen.findByText('Kisan Traders');
    expect(screen.queryByText('30 pack')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Count stock' })).toBeNull();
  });

  it('counts offline: held items first, a wrong figure explained, the count queued and shown', async () => {
    const db = nodeSqlite();
    await renderPhone({ name: 'stock_count', id: SUPPLIER }, db);
    expect(await screen.findByText('SEED-1 · 30 pack now')).toBeOnTheScreen();
    expect(screen.getByText('SPRAY-1 · -2 pack now')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Counted of Hybrid seed'), '-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Save the count' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/as numbers/);
    await fireEvent.changeText(screen.getByLabelText('Counted of Hybrid seed'), '28');
    await fireEvent.press(screen.getByRole('button', { name: 'Save the count' }));
    expect(
      await screen.findByText('Count saved. It uploads when you’re online.'),
    ).toBeOnTheScreen();
    const [queued] = (await new Outbox(db, {}).items(OWNER)).filter(
      (entry) => entry.kind === 'stock.count',
    );
    expect(queued?.payload).toMatchObject({
      body: { accountId: SUPPLIER, lines: [{ itemId: SEED, counted: '28' }] },
    });
  });

  it('lays counts still queued over what was synced', () => {
    const synced = pulled().entities.stock!.rows;
    const count = (counted: string) => ({
      body: {
        id: '01a10000-0000-7000-8000-0000000000f9',
        accountId: SUPPLIER,
        countedAt: '2026-11-02T06:00:00.000Z',
        lines: [{ itemId: SEED, counted }],
      },
    });
    expect([...stockOf(synced, [count('28'), count('27')], SUPPLIER)]).toEqual([
      [SEED, '27'],
      [SPRAY, '-2'],
    ]);
    expect(stockOf(synced, [count('28')], RETAILER).size).toBe(0);
  });

  it('shows the supplier’s stock in the cart and flags short lines, without refusing', async () => {
    await renderPhone({ name: 'order', id: RETAILER });
    expect(await screen.findByText(/Supplier has 30 pack/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Quantity of Hybrid seed/ }));
    await fireEvent.changeText(screen.getByLabelText('Quantity'), '36');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Review: 1 item/ }));
    expect(screen.getByText(/Supplier short by 6 pack/)).toBeOnTheScreen();
    expect(
      screen.getByText('Kisan Traders holds less than 1 line asks for. It can still be placed.'),
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Place the order/ })).toBeEnabled(),
    );
  });
});
