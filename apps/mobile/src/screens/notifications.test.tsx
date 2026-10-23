import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { openLink, usePushRegistration } from '../push';
import { SyncProvider } from '../sync';
import { NotificationsScreen } from './notifications';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[phone-1]' })),
  useLastNotificationResponse: () => null,
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';
const WAITING = '01a10000-0000-7000-8000-0000000000d1';
const LOCKED = '01a10000-0000-7000-8000-0000000000d2';

const INBOX = {
  items: [
    {
      id: WAITING,
      event: 'plan.today',
      category: 'plan',
      values: { count: 3 },
      link: '/',
      readAt: null,
      createdAt: '2026-10-21T02:30:00.000Z',
    },
    {
      id: LOCKED,
      event: 'approval.decided',
      category: 'approvals',
      values: { name: 'Priya Nair', outcome: 'approved' },
      link: null,
      readAt: '2026-10-20T10:00:00.000Z',
      createdAt: '2026-10-20T09:00:00.000Z',
    },
  ],
  nextCursor: null,
  unread: 1,
};

const PREFS = {
  categories: [
    { category: 'plan', muted: false, mutable: true },
    { category: 'approvals', muted: false, mutable: false },
    { category: 'review', muted: true, mutable: true },
    { category: 'targets', muted: false, mutable: true },
    { category: 'tracking', muted: false, mutable: false },
    { category: 'imports', muted: false, mutable: true },
  ],
};

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
    owner: `${TENANT.id}:${ASHA}`,
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
    registerPush: jest.fn<(body: unknown, key: string) => Promise<undefined>>(
      async () => undefined,
    ),
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(
      async (method, path, _s, options) => {
        const url = String(path);
        if (method === 'GET' && url.startsWith('/v1/notifications')) return INBOX;
        if (method === 'GET' && url === '/v1/notification-prefs') return PREFS;
        if (method === 'POST' && url === '/v1/notifications/read') return { unread: 0 };
        if (method === 'PUT' && url === '/v1/notification-prefs') {
          const { muted } = (options as { body: { muted: string[] } }).body;
          return {
            categories: PREFS.categories.map((entry) => ({
              ...entry,
              muted: muted.includes(entry.category),
            })),
          };
        }
        return {};
      },
    ),
    config: jest.fn(async () => ({
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
        access: { role: 'field_user', scope: 'self', permissions: [] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Registers() {
  usePushRegistration();
  return null;
}

function Shown({ page }: { page: 'inbox' | 'push' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'inbox' ? <NotificationsScreen /> : <Registers />;
}

async function renderPhone(page: 'inbox' | 'push') {
  const fake = fakeClient();
  const db = nodeSqlite();
  await migrate(db);
  await claim(db, fake.client.owner);
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

const writes = (client: ReturnType<typeof fakeClient>['client']) =>
  client.request.mock.calls.filter(([method]) => method !== 'GET');

describe('the inbox on the phone (M16)', () => {
  it('shows notifications in the reader’s words, and opens one, marking it read', async () => {
    const client = await renderPhone('inbox');
    const plan = await screen.findByRole('button', { name: /Today's plan, 3 planned visits/ });
    expect(screen.getByText(/Priya Nair approved your request/)).toBeOnTheScreen();
    await fireEvent.press(plan);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
    expect(writes(client)).toEqual([
      [
        'POST',
        '/v1/notifications/read',
        expect.anything(),
        { body: { ids: [WAITING] }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('saves what the person mutes, never approvals or tracking', async () => {
    const client = await renderPhone('inbox');
    const plan = await screen.findByRole('checkbox', { name: "Today's plan" });
    expect(screen.queryByRole('checkbox', { name: 'Approvals' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Rejected forms' })).not.toBeChecked();
    await fireEvent.press(plan);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writes(client)).toContainEqual([
        'PUT',
        '/v1/notification-prefs',
        expect.anything(),
        { body: { muted: ['plan', 'review'] }, idempotencyKey: expect.any(String) },
      ]),
    );
    expect(await screen.findByText('Saved.')).toBeOnTheScreen();
  });

  it('opens a link the app has, and the inbox for any other', () => {
    openLink('/');
    expect(router.push).toHaveBeenLastCalledWith('/');
    openLink('/approvals');
    expect(router.push).toHaveBeenLastCalledWith('/notifications');
    openLink(null);
    expect(router.push).toHaveBeenLastCalledWith('/notifications');
  });
});

describe('push on the phone (M16)', () => {
  it('asks once, then registers its address in the language it reads', async () => {
    const client = await renderPhone('push');
    await waitFor(() =>
      expect(client.registerPush).toHaveBeenCalledWith(
        { token: 'ExponentPushToken[phone-1]', locale: 'en' },
        expect.any(String),
      ),
    );
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('registers nothing when the person says no', async () => {
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    } as never);
    const client = await renderPhone('push');
    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.registerPush).not.toHaveBeenCalled();
  });
});
