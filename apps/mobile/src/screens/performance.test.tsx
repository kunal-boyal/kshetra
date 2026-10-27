import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { LeaderboardScreen } from './leaderboard';
import { MyMonth } from './my-month';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const person = (id: string, name: string) => ({ id, code: `SUN-${id.slice(-3)}`, name });

const metric = (key: string, one: string, unit: string, available = true) => ({
  key,
  name: noun(one, `${one}s`),
  unit,
  direction: 'higher_is_better',
  targetable: true,
  available,
  weight: null,
});

const MONTH = {
  period: '2026-10',
  user: person(ASHA, 'Asha Rao'),
  territory: null,
  metrics: [
    metric('reach', 'Coverage', 'percent'),
    metric('order_value', 'Order', 'currency', false),
    metric('sales', 'Sale', 'currency'),
    metric('calls', 'Call', 'count'),
  ],
  figures: {
    sales: { actual: '845000', pending: '112000', target: '1240000', attainment: 0.681 },
    calls: { actual: '2', pending: null, target: '4', attainment: 0.5 },
    reach: { actual: '50', pending: null, target: null, attainment: null },
    order_value: { actual: null, pending: null, target: null, attainment: null },
  },
  locked: true,
  score: 59,
  rank: 2,
  previousRank: null,
  group: { key: 'executive', name: noun('Executive', 'Executives'), size: 7 },
  days: [],
};

const BOARD = (group: string) => ({
  period: '2026-10',
  groups: [
    { key: 'executive', name: noun('Executive', 'Executives'), size: 2 },
    { key: 'officer', name: noun('Officer', 'Officers'), size: 1 },
  ],
  group,
  metrics: [],
  rows: (group === 'executive'
    ? [
        { user: person(RAVI, 'Ravi Kumar'), score: 100, rank: 1, you: false },
        { user: person(ASHA, 'Asha Rao'), score: 59, rank: 2, you: true },
      ]
    : [{ user: person(RAVI, 'Neha Joshi'), score: null, rank: null, you: false }]
  ).map((row) => ({ ...row, territory: null, figures: {}, previousRank: null })),
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
    owner: `${TENANT.id}:${ASHA}`,
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
      if (method === 'GET' && url.startsWith('/v1/performance?')) return MONTH;
      if (method === 'GET' && url.startsWith('/v1/leaderboard?')) {
        return BOARD(url.includes('group=officer') ? 'officer' : 'executive');
      }
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
          access: { role: 'field_user', scope: 'self', permissions: ['leaderboard.view'] },
        },
      };
    }),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'month' | 'board' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'month' ? <MyMonth /> : <LeaderboardScreen />;
}

async function renderPhone(
  page: 'month' | 'board',
  options: { offline?: boolean; db?: ReturnType<typeof nodeSqlite> } = {},
) {
  const fake = fakeClient(options.offline);
  const db = options.db ?? nodeSqlite();
  if (!options.db) {
    await migrate(db);
    // The phone is already this person's, as after an earlier sign-in.
    await claim(db, fake.client.owner);
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

describe('My month on Home (M9, spec 8.1)', () => {
  it('shows the score and rank, and tiles with targets first, money in lakh, pending apart', async () => {
    await renderPhone('month');
    expect(await screen.findByText('Score 59')).toBeOnTheScreen();
    expect(screen.getByText('Rank 2 of 7 Executives')).toBeOnTheScreen();
    expect(screen.getByText('₹8.5 L')).toBeOnTheScreen();
    expect(screen.getByText('68% of ₹12.4 L')).toBeOnTheScreen();
    expect(screen.getByText('+₹1.1 L pending')).toBeOnTheScreen();
    expect(screen.getByText('No target set')).toBeOnTheScreen();
    expect(screen.getByText('Not yet counted')).toBeOnTheScreen();
    const labels = screen
      .getAllByText(/^(Sales|Calls|Coverages|Orders)$/)
      .map((node) => node.props.children);
    expect(labels).toEqual(['Sales', 'Calls', 'Coverages', 'Orders']);
    await fireEvent.press(screen.getByRole('button', { name: 'Leaderboard' }));
    expect(router.push).toHaveBeenCalledWith('/leaderboard');
  });

  it('shows the last figures the phone read when there is no signal', async () => {
    const first = await renderPhone('month');
    expect(await screen.findByText('Score 59')).toBeOnTheScreen();
    await first.view.unmount();
    await renderPhone('month', { offline: true, db: first.db });
    expect(await screen.findByText('Score 59')).toBeOnTheScreen();
    expect(screen.getByText(/^As of /)).toBeOnTheScreen();
  });
});

describe('the leaderboard (M9, BR-07)', () => {
  it("ranks the person's group, marks them, and switches groups", async () => {
    const { client } = await renderPhone('board');
    expect(await screen.findByText('1. Ravi Kumar')).toBeOnTheScreen();
    expect(screen.getByText('Score 59 · (you)')).toBeOnTheScreen();
    expect(screen.getByText(/Indicative ranking/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: /Officers/ }));
    expect(await screen.findByText('Neha Joshi')).toBeOnTheScreen();
    expect(screen.getByText('Not ranked')).toBeOnTheScreen();
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('group=officer'),
        expect.anything(),
      ),
    );
  });
});
