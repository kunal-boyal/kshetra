import { describe, expect, it, jest } from '@jest/globals';
import { ApiError, type SessionState } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import { migrate } from '@kshetra/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult } from '@kshetra/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { ReviewItemScreen } from './review-item';
import { TeamScreen } from './team';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const MANAGER = '01a10000-0000-7000-8000-000000000003';
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const CLEAN = '01a10000-0000-7000-8000-0000000000e1';
const FLAGGED = '01a10000-0000-7000-8000-0000000000e2';
const PHOTO = '01a10000-0000-7000-8000-0000000000f1';
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
    form: { key: 'shop_visit', version: 1, name: noun('Shop visit', 'Shop visits') },
    account: { id: '01a10000-0000-7000-8000-0000000000a1', code: 'C-1', name: 'Sharma Stores' },
    visitId: null,
    shiftId: null,
    capturedAt: '2026-10-13T06:00:00.000Z',
    receivedAt: '2026-10-13T06:00:05.000Z',
    location: { lat: 28.6315, lng: 77.2167 },
    accuracy: 12,
    distanceM: 40,
    geofence: 'inside',
    values: { notes: 'Shelf restocked' },
    photos: [PHOTO],
    signatureMediaId: null,
    flags: [],
    status: 'pending',
    autoApproved: false,
    photoDetails: [
      {
        id: PHOTO,
        source: 'gallery',
        capturedAt: '2026-10-13T05:59:00.000Z',
        distanceM: 12,
        duplicate: false,
      },
    ],
    integrityWarning: false,
    autoApproveAt: null,
    reviews: [],
    ...overrides,
  };
}

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
    owner: `${TENANT.id}:${MANAGER}`,
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
      async (method: unknown, path: unknown, _schema: unknown, options: unknown) => {
        const url = String(path);
        if (method === 'GET' && url.startsWith('/v1/reviews/queue')) {
          return {
            items: [
              item(CLEAN),
              item(FLAGGED, { flags: ['outside_geofence'], geofence: 'outside', distanceM: 640 }),
            ],
            nextCursor: null,
          };
        }
        if (method === 'GET' && url.startsWith(`/v1/media/${PHOTO}/url`)) {
          return { url: 'https://objects.test/photo.jpg', expiresAt: '2030-01-01T00:00:00.000Z' };
        }
        if (method === 'POST' && url === `/v1/submissions/${CLEAN}/review`) {
          const body = (options as { body: { decision: string; note?: string } }).body;
          if (body.decision === 'rejected' && (body.note ?? '').length < 3) {
            throw new ApiError(400, 'VALIDATION', 'Say why.', [
              { path: 'note', issue: 'Too short' },
            ]);
          }
          return item(CLEAN, { status: body.decision });
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
        access: { role: 'manager', scope: 'team', permissions: ['submission.review'] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown({ page }: { page: 'team' | 'item' }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  return page === 'team' ? <TeamScreen /> : <ReviewItemScreen id={CLEAN} />;
}

async function renderPhone(page: 'team' | 'item') {
  const fake = fakeClient();
  const db = nodeSqlite();
  await migrate(db);
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

const reviews = (client: ReturnType<typeof fakeClient>['client']) =>
  client.request.mock.calls.filter(([, path]) => String(path).endsWith('/review'));

describe('the Team tab (M7, spec 8.1)', () => {
  it('lists what waits for review, marking what was flagged, and opens one', async () => {
    await renderPhone('team');
    expect(await screen.findByText('2 to review')).toBeOnTheScreen();
    const flagged = screen.getAllByRole('button', { name: /Shop visit · Rahul Verma/ });
    expect(flagged[1]).toHaveTextContent(/1 flag/);
    await fireEvent.press(flagged[0]!);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/review/[id]', params: { id: CLEAN } });
  });

  it('shows the evidence, and rejects only with a reason', async () => {
    const client = await renderPhone('item');
    expect(await screen.findByText('Shelf restocked')).toBeOnTheScreen();
    expect(screen.getByText('Inside, 40 m')).toBeOnTheScreen();
    expect(screen.getByText(/Gallery · 12 m from where the form was filled/)).toBeOnTheScreen();
    // The photo re-renders once its link answers, so look it up afresh each time.
    await waitFor(() => expect(screen.getByLabelText('Photo 1')).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole('button', { name: 'Reject' }));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    expect(await screen.findByText('At least 3 characters. The person sees it.')).toBeOnTheScreen();
    expect(reviews(client)).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText('Why *'), 'Photo of another shop');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/team'));
    expect(reviews(client)).toEqual([
      [
        'POST',
        `/v1/submissions/${CLEAN}/review`,
        expect.anything(),
        {
          body: { decision: 'rejected', note: 'Photo of another shop' },
          idempotencyKey: expect.any(String),
        },
      ],
    ]);
  });

  it('approves with one press, and goes back to the queue', async () => {
    const client = await renderPhone('item');
    await fireEvent.press(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/team'));
    expect(reviews(client)).toEqual([
      [
        'POST',
        `/v1/submissions/${CLEAN}/review`,
        expect.anything(),
        { body: { decision: 'approved' }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });
});
