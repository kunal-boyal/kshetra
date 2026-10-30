import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { phoneScreens, SearchScreen } from './search';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ME = '01a10000-0000-7000-8000-000000000004';
const ASHA = '01a10000-0000-7000-8000-000000000005';
const MARKET = '01a10000-0000-7000-8000-000000000010';
const JANPATH = '01a10000-0000-7000-8000-000000000080';

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

const person = (id: string, code: string, name: string) => ({
  id,
  code,
  name,
  phone: null,
  designation: 'executive',
  role: 'field_user',
  managerId: null,
  status: 'active' as const,
});

function pulled(): SyncPullResult {
  return {
    entities: {
      users: full([person(ME, 'SUN-004', 'Priya Nair'), person(ASHA, 'SUN-005', 'Asha Verma')]),
      territories: full([
        { id: MARKET, parentId: null, level: 1, code: 'N-DEL', name: 'Delhi Market', active: true },
      ]),
      accounts: full([
        {
          id: JANPATH,
          type: 'customer',
          code: 'C-80',
          name: 'Janpath Mart',
          territoryId: MARKET,
          parentId: null,
          address: {},
          location: null,
          geofenceRadiusM: null,
          locationStatus: 'unverified',
          status: 'active',
          segments: [],
          custom: {},
          slots: [{ slot: 'executive', userId: ME }],
        },
      ]) as SyncPullResult['entities']['accounts'],
      items: full([]),
      contacts: full([]),
    },
    cursor: 'c1',
    more: false,
  };
}

function fakeClient(permissions: string[]) {
  const session: SessionState = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const client = {
    session,
    owner: `${TENANT.id}:${ME}`,
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => undefined),
    syncPull: jest.fn(async () => pulled()),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-7"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'manager', scope: 'team', permissions },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown() {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return <SearchScreen />;
}

async function renderSearch(permissions: string[]) {
  const db = nodeSqlite();
  await migrate(db);
  const fake = fakeClient(permissions);
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
}

describe('search on the phone (phase 4 step A1, D110)', () => {
  it('finds the accounts the phone keeps and opens one', async () => {
    await renderSearch(['account.view']);
    await fireEvent.changeText(await screen.findByLabelText('Search'), 'janpath');
    await fireEvent.press(await screen.findByText('Janpath Mart'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/accounts/[id]',
      params: { id: JANPATH },
    });
  });

  it('lists people only for those who may open their day', async () => {
    await renderSearch(['account.view', 'trail.view']);
    await fireEvent.changeText(await screen.findByLabelText('Search'), 'asha');
    await fireEvent.press(await screen.findByText('Asha Verma'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/day/[id]', params: { id: ASHA } });
  });

  it('says what it searches when nothing matches', async () => {
    await renderSearch(['account.view']);
    await fireEvent.changeText(await screen.findByLabelText('Search'), 'asha');
    expect(await screen.findByText('Nothing matches “asha”.')).toBeOnTheScreen();
    expect(screen.queryByText('Asha Verma')).toBeNull();
  });
});

describe('the screens search finds', () => {
  const t = ((key: string) => key) as Parameters<typeof phoneScreens>[2];

  it('follow the permissions and the modules on', () => {
    const paths = (held: string[], off: string[] = []) =>
      phoneScreens(new Set(held), off, t).map((entry) => entry.path);
    expect(paths(['order.create', 'expense.claim'])).toEqual(['/', '/orders', '/me', '/expenses']);
    expect(paths(['order.create', 'expense.claim'], ['orders', 'expenses'])).toEqual(['/', '/me']);
  });
});
