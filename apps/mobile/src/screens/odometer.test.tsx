import { describe, expect, it, jest } from '@jest/globals';
import { NetworkError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, Outbox, type SqlDatabase, Tracking } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import { addResult } from '../capture-results';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { PunchInScreen } from './punch-in';
import { PunchOutScreen } from './punch-out';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  // Every render stands for coming back to the screen, so the camera's results are collected.
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => effect());
  },
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
const PHOTO = '01a10000-0000-7000-8000-0000000000e1';

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

// Offline throughout, so what was queued stays in the outbox to be read.
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
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => {
      throw new NetworkError('offline');
    }),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: { ...SETTING_DEFAULTS, odometer: 'required' },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'field_user', scope: 'self', permissions: ['shift.use'] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'punch-in' | 'punch-out' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'punch-in' ? <PunchInScreen /> : <PunchOutScreen />;
}

async function renderPhone(page: 'punch-in' | 'punch-out', db: SqlDatabase) {
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
}

/** The camera, standing in: the photo is taken and the screen comes back to collect it. */
async function photograph(request: string) {
  await fireEvent.press(screen.getByRole('button', { name: 'Photograph the odometer' }));
  addResult(request, PHOTO);
}

describe('the odometer at punches (decision D99)', () => {
  it('asks for the reading and its photo at punch-in, and sends them with it', async () => {
    mockTracking = false;
    const db = nodeSqlite();
    await migrate(db);
    await renderPhone('punch-in', db);
    await fireEvent.press(await screen.findByRole('button', { name: 'I agree, find my location' }));
    expect(
      await screen.findByText(
        'Your organisation asks for the vehicle’s odometer reading and a photo of it.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter the reading.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Odometer reading/), '12045');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Take a photo of the odometer too.')).toBeOnTheScreen();
    await photograph('punch-in-odometer');
    await fireEvent.changeText(screen.getByLabelText(/^Odometer reading/), '12045');
    expect(await screen.findByText('Photo taken')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start day' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const [start] = await new Outbox(db, {}).items(OWNER);
    expect(start).toMatchObject({
      kind: 'shift.start',
      payload: { odometer: { reading: '12045', photoId: PHOTO } },
      // The photo uploads first, so the punch-in can attach it.
      dependsOn: [PHOTO],
    });
    const shiftId = (start!.payload as { id: string }).id;
    expect(await new Tracking(db).odometer(OWNER, shiftId)).toMatchObject({
      date: todayIn(SETTING_DEFAULTS.timezone),
      open: '12045',
      close: null,
    });
  });

  it('refuses a closing reading below the opening one, then punches out with it', async () => {
    mockTracking = true;
    const db = nodeSqlite();
    await migrate(db);
    const tracking = new Tracking(db);
    await db.transaction(async (tx) => {
      await tracking.open(tx, {
        owner: OWNER,
        shiftId: SHIFT,
        startedAt: Date.now() - 8 * 3_600_000,
        endsBy: Date.now() + 6 * 3_600_000,
        intervalSeconds: 120,
      });
      await tracking.openOdometer(tx, OWNER, {
        shiftId: SHIFT,
        date: todayIn(SETTING_DEFAULTS.timezone),
        reading: '12045',
      });
    });
    await renderPhone('punch-out', db);
    expect(await screen.findByText('Opening reading: 12,045 km')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Odometer reading/), '12000');
    await photograph('punch-out-odometer');
    await fireEvent.press(screen.getByRole('button', { name: 'End day' }));
    expect(
      await screen.findByText('This is below the opening reading, 12,045 km.'),
    ).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Odometer reading/), '12098.5');
    await fireEvent.press(screen.getByRole('button', { name: 'End day' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    const [end] = await new Outbox(db, {}).items(OWNER);
    expect(end).toMatchObject({
      kind: 'shift.end',
      payload: { shiftId: SHIFT, odometer: { reading: '12098.5', photoId: PHOTO } },
      dependsOn: [SHIFT, PHOTO],
    });
    expect(await tracking.odometer(OWNER, SHIFT)).toMatchObject({
      open: '12045',
      close: '12098.5',
      closeUploadId: end!.id,
    });
    expect(await tracking.current(OWNER)).toBeNull();
  });
});
