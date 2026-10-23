import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, type SqlDatabase, Tracking, Visits } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { AccountScreen } from './account';
import { TodayPlan } from './today-plan';
import { TodayRouteScreen } from './today-route';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
// The phone stands at Connaught Place, New Delhi, known to within 12 m.
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Highest: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  getBackgroundPermissionsAsync: async () => ({ granted: true }),
  hasStartedLocationUpdatesAsync: async () => false,
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 28.6315, longitude: 77.2167, accuracy: 12 },
    timestamp: Date.now(),
    mocked: false,
  }),
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const USER = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${USER}`;
const MARKET = '01a10000-0000-7000-8000-000000000010';
const HERE = '01a10000-0000-7000-8000-000000000080';
const FAR = '01a10000-0000-7000-8000-000000000081';
const SHIFT = '01a10000-0000-7000-8000-0000000000c1';
const PLANNED = '01a10000-0000-7000-8000-0000000000d7';
const TODAY = todayIn('Asia/Kolkata');
const text = (en: string) => ({ en, hi: en });
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

function customerType(geofencePolicy: 'advisory' | 'required') {
  return {
    id: '01a10000-0000-7000-8000-000000000070',
    version: 1,
    key: 'customer',
    name: noun('Customer', 'Customers'),
    icon: 'store',
    active: true,
    parentTypes: [],
    code: { mode: 'manual' },
    fields: [],
    location: { required: false, geofencePolicy, fieldUsersMayPropose: false },
    creation: 'admins',
    slots: [],
    segmentRules: [],
    visitFrequencyNorms: [],
    contacts: false,
  };
}

const VISIT_REPORT = {
  id: '01a10000-0000-7000-8000-0000000000f2',
  version: 1,
  active: true,
  key: 'visit_report',
  name: noun('Visit report', 'Visit reports'),
  icon: 'clipboard-list',
  tags: [],
  accountLink: { mode: 'required', accountTypes: ['customer'] },
  visitSession: true,
  shift: 'required',
  signature: 'none',
  geofence: 'inherit',
  review: 'manual',
  fields: [{ key: 'notes', type: 'long_text', label: text('Notes'), required: false }],
};

function account(id: string, name: string, location: { lat: number; lng: number }) {
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
    locationStatus: 'verified',
    status: 'active',
    segments: [],
    custom: {},
    slots: [],
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
      users: full([]),
      territories: full([]),
      accounts: full([
        // Where the phone stands, and about 2.4 km away at India Gate.
        account(HERE, 'Janpath Mart', { lat: 28.6315, lng: 77.2167 }),
        account(FAR, 'India Gate Stores', { lat: 28.6129, lng: 77.2295 }),
      ]) as SyncPullResult['entities']['accounts'],
      contacts: full([]),
      items: full([]),
      plan_items: full([
        {
          id: PLANNED,
          accountId: HERE,
          date: TODAY,
          purpose: 'Collect payment',
          note: 'Ask for the cheque',
          status: 'planned' as const,
          source: 'route' as const,
          visitId: null,
        },
      ]),
    },
    cursor: 'c1',
    more: false,
  };
}

function fakeClient(policy: 'advisory' | 'required') {
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
    syncPull: jest.fn(async () => pulled()),
    heartbeat: jest.fn(async () => undefined),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [customerType(policy)],
        forms: [VISIT_REPORT],
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'field_user',
          scope: 'self',
          permissions: ['account.view', 'shift.use', 'visit.use', 'submission.create'],
        },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ id }: { id: string }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (id === 'route') return <TodayRouteScreen />;
  return id === 'today' ? <TodayPlan /> : <AccountScreen id={id} />;
}

async function phone(onDuty: boolean) {
  const db = nodeSqlite();
  await migrate(db);
  if (onDuty) {
    await db.transaction((tx) =>
      new Tracking(db).open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 3_600_000,
        endsBy: Date.now() + 12 * 3_600_000,
        intervalSeconds: 120,
      }),
    );
  }
  return db;
}

async function renderAt(id: string, db: SqlDatabase, policy: 'advisory' | 'required' = 'advisory') {
  const fake = fakeClient(policy);
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
            <Shown id={id} />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return fake.client;
}

const posts = (client: ReturnType<typeof fakeClient>['client']) =>
  client.request.mock.calls.filter(([method]) => method === 'POST');

describe('visits on the phone (M6)', () => {
  it('checks in on duty inside the geofence, offers the visit forms, and checks out', async () => {
    const db = await phone(true);
    const client = await renderAt(HERE, db);
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('Checked in')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Visit report' })).toBeOnTheScreen();
    const visit = await new Visits(db).current(OWNER);
    expect(visit).toMatchObject({ accountId: HERE, shiftId: SHIFT });
    await waitFor(() =>
      expect(posts(client)).toContainEqual([
        'POST',
        '/v1/visits',
        expect.anything(),
        {
          body: expect.objectContaining({
            id: visit!.visitId,
            accountId: HERE,
            fix: expect.objectContaining({ location: { lat: 28.6315, lng: 77.2167 } }),
          }),
        },
      ]),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Check out' }));
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeOnTheScreen();
    expect(await new Visits(db).current(OWNER)).toBeNull();
    await waitFor(() =>
      expect(posts(client).map(([, path]) => path)).toContain(
        `/v1/visits/${visit!.visitId}/check-out`,
      ),
    );
  });

  it('refuses a check-in outside a required geofence, saying how far', async () => {
    const db = await phone(true);
    const client = await renderAt(FAR, db, 'required');
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in' }));
    expect(
      await screen.findByText(
        /^You are 2,\d{3} m away\. Check in within [\d,]+ m of this account\.$/,
      ),
    ).toBeOnTheScreen();
    expect(await new Visits(db).current(OWNER)).toBeNull();
    expect(posts(client)).toEqual([]);
  });

  it('lets an advisory geofence through, marked outside', async () => {
    const db = await phone(true);
    await renderAt(FAR, db);
    await fireEvent.press(await screen.findByRole('button', { name: 'Check in' }));
    expect(
      await screen.findByText(/^Checked in 2,\d{3} m away, outside the geofence\./),
    ).toBeOnTheScreen();
    expect(await new Visits(db).current(OWNER)).toMatchObject({ accountId: FAR });
  });

  it('asks for the day to start first', async () => {
    await renderAt(HERE, await phone(false));
    expect(await screen.findByText('Start your day to check in.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it("shows today's plan with each visit's status and purpose", async () => {
    await renderAt('today', await phone(true));
    const row = await screen.findByRole('button', { name: /Janpath Mart/ });
    expect(row).toHaveTextContent(/Planned · Collect payment/);
  });

  it('carries the planned visit on check-in, and offers no second plan for it', async () => {
    const db = await phone(true);
    const client = await renderAt(HERE, db);
    expect(await screen.findByText(/Planned for today: Collect payment/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "Add to today's plan" })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() =>
      expect(posts(client)).toContainEqual([
        'POST',
        '/v1/visits',
        expect.anything(),
        { body: expect.objectContaining({ accountId: HERE, planItemId: PLANNED }) },
      ]),
    );
  });

  it("adds a place to today's plan from its screen", async () => {
    const db = await phone(true);
    const client = await renderAt(FAR, db);
    await fireEvent.press(await screen.findByRole('button', { name: "Add to today's plan" }));
    expect(await screen.findByText("Added to today's plan.")).toBeOnTheScreen();
    await waitFor(() =>
      expect(posts(client)).toContainEqual([
        'POST',
        '/v1/plan-items',
        expect.anything(),
        {
          body: expect.objectContaining({
            userId: USER,
            accountId: FAR,
            date: TODAY,
          }),
        },
      ]),
    );
  });
});

describe('maps on a visit (M17)', () => {
  it('shows the place, the geofence and a green pill inside it', async () => {
    await renderAt(HERE, await phone(true));
    expect(await screen.findByText('Inside the geofence · 0 m')).toBeOnTheScreen();
    expect(screen.getByLabelText('Map of Janpath Mart and where you are')).toBeOnTheScreen();
    expect(screen.getByLabelText('You are here')).toBeOnTheScreen();
  });

  it('says how far away the phone is, outside the geofence', async () => {
    await renderAt(FAR, await phone(true));
    expect(await screen.findByText(/^2,\d{3} m away, outside the geofence$/)).toBeOnTheScreen();
  });

  it("opens today's route as numbered stops", async () => {
    await renderAt('today', await phone(true));
    await fireEvent.press(
      await screen.findByRole('button', { name: "See today's route on a map" }),
    );
    expect(router.push).toHaveBeenCalledWith('/today-route');
  });

  it("draws today's route, stop by stop, with each stop's status", async () => {
    await renderAt('route', await phone(true));
    expect(await screen.findByRole('button', { name: /1\. Janpath Mart/ })).toHaveTextContent(
      /Planned/,
    );
    expect(screen.getByLabelText("Map of today's planned visits, stop by stop")).toBeOnTheScreen();
    expect(screen.getByLabelText('1. Janpath Mart')).toBeOnTheScreen();
  });
});
