import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import { migrate, type SqlDatabase } from '@kshetra/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@kshetra/shared';
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
const MARKET = '01a10000-0000-7000-8000-000000000010';
const NEAR = '01a10000-0000-7000-8000-000000000080';
const FAR = '01a10000-0000-7000-8000-000000000081';
const UNPLACED = '01a10000-0000-7000-8000-000000000082';
const text = (en: string) => ({ en, hi: en });

const CUSTOMER = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'customer',
  name: { en: { one: 'Customer', other: 'Customers' }, hi: { one: 'ग्राहक', other: 'ग्राहक' } },
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [],
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

function fakeClient() {
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
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [CUSTOMER],
        access: {
          role: 'field_user',
          scope: 'self',
          permissions: ['account.view', 'account.propose', 'account.propose_location'],
        },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

type Page = { name: 'list' } | { name: 'account'; id: string } | { name: 'new' };

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page.name === 'list') return <AccountsScreen />;
  if (page.name === 'new') return <NewAccountScreen typeKey="customer" />;
  return <AccountScreen id={page.id} />;
}

async function renderPhone(page: Page, db: SqlDatabase = nodeSqlite()) {
  await migrate(db);
  const fake = fakeClient();
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
    expect(screen.getByText('Rahul Verma')).toBeOnTheScreen();

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

  it('proposes a new place, kept on the phone as waiting and sent for approval', async () => {
    const db = nodeSqlite();
    const client = await renderPhone({ name: 'new' }, db);
    expect(await screen.findByText('Propose a new Customer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Send for approval' }));
    expect(screen.getByText('Fill in the name')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(/^Name/), 'Naya Bazaar Store');
    await fireEvent.changeText(screen.getByLabelText(/^Code/), 'C-99');
    await fireEvent.press(await screen.findByRole('radio', { name: /Delhi Market/ }));
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
        },
      }),
    );
  });
});
