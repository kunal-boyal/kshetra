import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { MyDataScreen } from './my-data';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const ASHA = '01a10000-0000-7000-8000-000000000004';

const ANSWERED = {
  id: '01a10000-0000-7000-8000-0000000000a1',
  person: { id: ASHA, name: 'Asha Rao', code: 'SUN-004' },
  kind: 'correction',
  status: 'completed',
  details: 'My name is spelt wrong',
  response: 'Corrected to Asha Rao',
  raisedBy: { self: true, name: 'Asha Rao' },
  dueOn: '2026-11-20',
  createdAt: '2026-10-21T05:00:00.000Z',
  closedAt: '2026-10-22T05:00:00.000Z',
  closedBy: 'Anita Rao',
  archive: null,
  download: null,
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
  let items: object[] = [ANSWERED];
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
    request: jest.fn<(...args: unknown[]) => Promise<unknown>>(
      async (method, path, _s, options) => {
        if (path !== '/v1/me/data-requests') return {};
        if (method === 'GET') return { items };
        const body = (options as { body: { id: string; kind: string; details: string } }).body;
        const made = {
          ...ANSWERED,
          ...body,
          status: 'received',
          response: null,
          dueOn: '2026-11-25',
          closedAt: null,
          closedBy: null,
        };
        items = [made, ...items];
        return made;
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

function Shown() {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return <MyDataScreen />;
}

async function renderPhone() {
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
            <Shown />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return fake.client;
}

describe('my data on the phone (M21, D95)', () => {
  it('shows the person’s requests and the organisation’s answers', async () => {
    await renderPhone();
    expect(await screen.findByText('A correction to my data · Done')).toBeOnTheScreen();
    expect(screen.getByText('Their answer: Corrected to Asha Rao')).toBeOnTheScreen();
  });

  it('sends a request for a copy, and says when it will be answered', async () => {
    const client = await renderPhone();
    await screen.findByText('A correction to my data · Done');
    await fireEvent.changeText(screen.getByLabelText('Anything to add'), 'Everything you hold');
    await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('Sent. Your organisation answers by 25 Nov 2026.'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('A copy of my data · Open')).toBeOnTheScreen();
    const sent = client.request.mock.calls.find(([method]) => method === 'POST');
    expect(sent).toEqual([
      'POST',
      '/v1/me/data-requests',
      expect.anything(),
      {
        body: { id: expect.any(String), kind: 'access', details: 'Everything you hold' },
        idempotencyKey: expect.any(String),
      },
    ]);
    await waitFor(() => expect(client.request).toHaveBeenCalled());
  });
});
