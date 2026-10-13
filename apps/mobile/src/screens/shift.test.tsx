import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import { migrate, Outbox, type SqlDatabase, Tracking } from '@kshetra/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@kshetra/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { PunchInScreen } from './punch-in';
import { ShiftSection } from './shift';
import { brandOf } from './tracking-help';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useFocusEffect: () => undefined,
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({
  isBatteryOptimizationEnabledAsync: async () => false,
  getBatteryLevelAsync: async () => 0.8,
}));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => true, defineTask: jest.fn() }));
// The phone stands at Connaught Place, New Delhi, known to within 12 m, unless a test says.
const mockFix = { accuracy: 12, mocked: false };
let mockTracking = false;
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Highest: 6 },
  ActivityType: { Other: 1 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  requestBackgroundPermissionsAsync: async () => ({ granted: true }),
  getBackgroundPermissionsAsync: async () => ({ granted: true }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 28.6315, longitude: 77.2167, accuracy: mockFix.accuracy },
    timestamp: Date.now(),
    mocked: mockFix.mocked,
  }),
  hasStartedLocationUpdatesAsync: async () => mockTracking,
  startLocationUpdatesAsync: jest.fn(async () => {
    mockTracking = true;
  }),
  stopLocationUpdatesAsync: jest.fn(async () => {
    mockTracking = false;
  }),
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const USER = '01a10000-0000-7000-8000-000000000004';
const OWNER = `${TENANT.id}:${USER}`;
const SHIFT = '01a10000-0000-7000-8000-0000000000d1';

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function fakeClient() {
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
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: { ...SETTING_DEFAULTS, gpsIntervalSeconds: 120 },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'field_user', scope: 'self', permissions: ['shift.use', 'tracking.pause'] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'home' | 'punch-in' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'home' ? <ShiftSection /> : <PunchInScreen />;
}

async function renderPhone(page: 'home' | 'punch-in', db: SqlDatabase) {
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

async function freshDatabase(open = false) {
  const db = nodeSqlite();
  await migrate(db);
  if (open) {
    await db.transaction((tx) =>
      new Tracking(db).open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 2 * 3_600_000,
        endsBy: Date.now() + 12 * 3_600_000,
        intervalSeconds: 120,
      }),
    );
  }
  return db;
}

const posts = (client: ReturnType<typeof fakeClient>['client']) =>
  client.request.mock.calls.filter(([method]) => method === 'POST');

describe('the shift on the phone (M5)', () => {
  it('starts the day from Home, off duty, through the consent sheet', async () => {
    mockTracking = false;
    await renderPhone('home', await freshDatabase());
    await fireEvent.press(await screen.findByRole('button', { name: 'Start day' }));
    expect(router.push).toHaveBeenCalledWith('/punch-in');
    expect(screen.getByText('Off duty')).toBeOnTheScreen();
    expect(screen.getByText(/Location is recorded only while you are on duty/)).toBeOnTheScreen();
  });

  it('punches in after consent and a good fix, saves on the phone, sends it and starts recording', async () => {
    mockTracking = false;
    mockFix.accuracy = 12;
    mockFix.mocked = false;
    const db = await freshDatabase();
    const client = await renderPhone('punch-in', db);
    expect(
      await screen.findByText(
        'Your location is recorded about every 2 minutes while you are on duty.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'I agree, find my location' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start day' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      'shift-location',
      expect.objectContaining({ timeInterval: 120_000, distanceInterval: 0 }),
    );
    expect(await new Tracking(db).current(OWNER)).toMatchObject({ intervalSeconds: 120 });
    await waitFor(() =>
      expect(posts(client)).toContainEqual([
        'POST',
        '/v1/shifts',
        expect.anything(),
        {
          body: expect.objectContaining({
            location: { lat: 28.6315, lng: 77.2167 },
            accuracy: 12,
            mocked: false,
            consentVersion: '2026-10',
          }),
        },
      ]),
    );
  });

  it('refuses a mocked or vague fix', async () => {
    mockFix.mocked = true;
    const db = await freshDatabase();
    await renderPhone('punch-in', db);
    await fireEvent.press(await screen.findByRole('button', { name: 'I agree, find my location' }));
    expect(
      await screen.findByText('This location is mocked. Turn off any app that fakes it.'),
    ).toBeOnTheScreen();
    mockFix.mocked = false;
    mockFix.accuracy = 400;
    await fireEvent.press(screen.getByRole('button', { name: 'I agree, find my location' }));
    expect(await screen.findByText(/not accurate enough yet/)).toBeOnTheScreen();
    mockFix.accuracy = 12;
    expect(await new Tracking(db).current(OWNER)).toBeNull();
  });

  it('pauses with a reason, resumes, and ends the day, each saved and sent in order', async () => {
    mockTracking = true;
    const db = await freshDatabase(true);
    const client = await renderPhone('home', db);
    expect(await screen.findByText('Tracking')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause tracking' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'A break' }));
    expect(await screen.findByText('Paused')).toBeOnTheScreen();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Resume tracking' }));
    expect(await screen.findByText('Tracking')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'End day' }));
    expect(await screen.findByRole('button', { name: 'Start day' })).toBeOnTheScreen();
    await waitFor(() =>
      expect(posts(client).map(([, path]) => path)).toEqual([
        `/v1/shifts/${SHIFT}/pauses`,
        expect.stringMatching(new RegExp(`^/v1/shifts/${SHIFT}/pauses/.+/resume$`)),
        `/v1/shifts/${SHIFT}/end`,
      ]),
    );
    expect(posts(client)[0]![3]).toEqual({
      body: expect.objectContaining({ reason: 'A break' }),
    });
    expect(await new Outbox(db, {}).items(OWNER)).toEqual([]);
  });

  it('says when recording stopped by itself, and how to fix it', async () => {
    mockTracking = false;
    await renderPhone('home', await freshDatabase(true));
    expect(await screen.findByText('Not recording')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Fix this' }));
    expect(router.push).toHaveBeenCalledWith('/tracking-help');
  });
});

describe('help for phones that stop background apps', () => {
  it('knows the makers by the names phones report', () => {
    expect(brandOf('Xiaomi')).toBe('xiaomi');
    expect(brandOf('Redmi')).toBe('xiaomi');
    expect(brandOf('samsung')).toBe('samsung');
    expect(brandOf('OnePlus')).toBe('oneplus');
    expect(brandOf('Google')).toBe('other');
    expect(brandOf(null)).toBe('other');
  });
});
