import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, Outbox, type SqlDatabase } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { HomeScreen } from './home';
import { MeScreen } from './me';
import { UploadsScreen } from './uploads';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
// Notes stand in for captured records: the server refuses some, and some find no network.
jest.mock('../outbox-kinds', () => {
  const { ApiError, NetworkError } =
    jest.requireActual<typeof import('@thelamp/api-client')>('@thelamp/api-client');
  return {
    senders: () => ({
      note: {
        send: async (payload: { refuse?: boolean; offline?: boolean }) => {
          if (payload.refuse) throw new ApiError(400, 'VALIDATION', 'Bad note.');
          if (payload.offline) throw new NetworkError(new TypeError('Network request failed'));
        },
      },
    }),
    itemLabel: (item: { payload: { n: number } }) => `Note ${item.payload.n}`,
  };
});

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const USER = '01a10000-0000-7000-8000-000000000002';
const OWNER = `${TENANT.id}:${USER}`;

const nothingNew = (): SyncPullResult => {
  const none = { pass: 'changes' as const, first: true, done: true, rows: [], removed: [] };
  return { entities: { users: none, territories: none }, cursor: 'c1', more: false };
};

/** A signed-in client that answers like the API. */
function fakeClient() {
  let session: SessionState | null = {
    tenant: TENANT,
    accessToken: 'a1',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  let signedOut = () => undefined as void;
  const client = {
    get session() {
      return session;
    },
    get owner() {
      return session ? OWNER : null;
    },
    restore: jest.fn(async () => session),
    signOut: jest.fn(async () => {
      session = null;
      signedOut();
    }),
    syncPull: jest.fn(async () => nothingNew()),
    heartbeat: jest.fn(async () => undefined),
    me: jest.fn(async () => ({
      userId: USER,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-001',
      name: 'Anita Rao',
      designation: 'head',
      role: 'field_user',
      scope: 'self',
      permissions: [],
      deviceId: '01a10000-0000-7000-8000-000000000003',
    })),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        access: { role: 'field_user', scope: 'self', permissions: [] },
      },
    })),
  };
  return {
    client,
    create: (events: { onSignedOut: () => void }) => {
      signedOut = events.onSignedOut;
      return client as unknown as MobileClient;
    },
  };
}

/** A phone database holding these notes, saved by the signed-in person. */
async function phoneWith(...notes: { n: number; refuse?: boolean; offline?: boolean }[]) {
  const db = nodeSqlite();
  await migrate(db);
  const outbox = new Outbox(db, {});
  for (const note of notes) {
    await outbox.enqueue(db, { id: `note-${note.n}`, owner: OWNER, kind: 'note', payload: note });
  }
  return { db, outbox };
}

function Shown({ page }: { page: 'home' | 'uploads' | 'me' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page === 'home') return <HomeScreen />;
  return page === 'me' ? <MeScreen /> : <UploadsScreen />;
}

async function renderPhone(db: SqlDatabase, page: 'home' | 'uploads' | 'me') {
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
  return fake;
}

describe('the sync banner', () => {
  it('turns red when something was refused, and opens the upload queue', async () => {
    const { db } = await phoneWith({ n: 1, refuse: true }, { n: 2 });
    await renderPhone(db, 'home');
    const banner = await screen.findByRole('button', {
      name: '1 item was refused. Open the upload queue to see why. View',
    });
    await fireEvent.press(banner);
    expect(router.push).toHaveBeenCalledWith('/uploads');
  });

  it('is amber while items wait without signal', async () => {
    const { db } = await phoneWith({ n: 1, offline: true }, { n: 2 });
    await renderPhone(db, 'home');
    expect(await screen.findByText('Offline. 2 items are saved on this phone.')).toBeOnTheScreen();
  });

  it('is gone when everything has uploaded', async () => {
    const { db } = await phoneWith({ n: 1 });
    await renderPhone(db, 'home');
    expect(await screen.findByText(/^Good (morning|afternoon|evening), Anita$/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /View$/ })).toBeNull();
  });
});

describe('the upload queue', () => {
  it('shows why each record waits, and retries or discards refused ones, asking first', async () => {
    const { db, outbox } = await phoneWith({ n: 1, refuse: true }, { n: 2, offline: true });
    await renderPhone(db, 'uploads');

    expect(await screen.findByText('Note 1')).toBeOnTheScreen();
    expect(screen.getByText('Refused')).toBeOnTheScreen();
    expect(
      screen.getByText('Some details need fixing. Check the highlighted fields.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Note 2')).toBeOnTheScreen();
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(
      screen.getByText('No signal. Everything uploads by itself when it returns.'),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(
      screen.getByText('Discard this record? It is deleted from this phone and will never upload.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
    expect((await outbox.items(OWNER)).map((item) => item.id)).toEqual(['note-1', 'note-2']);

    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard it' }));
    expect(await screen.findByText('Note 2')).toBeOnTheScreen();
    expect(screen.queryByText('Note 1')).toBeNull();
    expect((await outbox.items(OWNER)).map((item) => item.id)).toEqual(['note-2']);
  });

  it('says when everything has uploaded', async () => {
    const { db } = await phoneWith({ n: 1 });
    await renderPhone(db, 'uploads');
    expect(await screen.findByText('Everything has uploaded')).toBeOnTheScreen();
  });
});

describe('signing out', () => {
  it('warns about unsent records first, and keeps them on the phone', async () => {
    const { db, outbox } = await phoneWith({ n: 1, refuse: true });
    const fake = await renderPhone(db, 'me');
    expect(await screen.findByText('1 waiting')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      screen.getByText(
        "1 record hasn't uploaded. It stays on this phone and uploads when you sign in again.",
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(fake.client.signOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(fake.client.signOut).toHaveBeenCalledTimes(1);
    expect((await outbox.items(OWNER)).map((item) => item.id)).toEqual(['note-1']);
  });
});
