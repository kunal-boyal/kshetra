import { describe, expect, it, jest } from '@jest/globals';
import { ApiError, type SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS, type SyncPullResult, todayIn } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { ApprovalItemScreen } from './approval-item';
import { PersonDayScreen } from './person-day';
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
const REQUEST = '01a10000-0000-7000-8000-0000000000d1';
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

const APPROVAL = {
  id: REQUEST,
  requestType: 'new_account',
  requestId: '01a10000-0000-7000-8000-0000000000a2',
  subject: { title: 'Gupta Kirana (C-2)', accountId: '01a10000-0000-7000-8000-0000000000a2' },
  requester: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
  status: 'pending',
  version: 2,
  steps: [
    {
      index: 0,
      approvers: [{ id: MANAGER, code: 'SUN-003', name: 'Meena Shah' }],
      status: 'skipped',
      actedBy: null,
      actedAt: null,
      note: null,
      skipReason: 'repeated',
      escalated: false,
      fallback: false,
    },
    {
      index: 1,
      approvers: [{ id: MANAGER, code: 'SUN-003', name: 'Meena Shah' }],
      status: 'pending',
      actedBy: null,
      actedAt: null,
      note: null,
      skipReason: null,
      escalated: true,
      fallback: false,
    },
  ],
  cancellable: true,
  bulk: true,
  page: null,
  createdAt: '2026-10-13T05:00:00.000Z',
  closedAt: null,
};

const READ_AT = new Date().toISOString();
const before = (minutes: number) => new Date(Date.parse(READ_AT) - minutes * 60_000).toISOString();
const TODAY = todayIn('Asia/Kolkata');
const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86_400_000)
  .toISOString()
  .slice(0, 10);
const SHOP = { id: '01a10000-0000-7000-8000-0000000000a1', code: 'C-1', name: 'Sharma Stores' };

const LIVE = {
  readAt: READ_AT,
  people: [
    {
      user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
      shiftId: '01a10000-0000-7000-8000-0000000000c1',
      onDutySince: before(120),
      paused: false,
      position: { lat: 28.6315, lng: 77.2167 },
      accuracy: 12,
      battery: 80,
      seenAt: before(4),
      visit: { account: SHOP, checkInAt: before(10) },
    },
    {
      user: { id: '01a10000-0000-7000-8000-000000000005', code: 'SUN-005', name: 'Kavya Iyer' },
      shiftId: '01a10000-0000-7000-8000-0000000000c2',
      onDutySince: before(90),
      paused: true,
      position: { lat: 28.64, lng: 77.22 },
      accuracy: 20,
      battery: null,
      seenAt: before(40),
      visit: null,
    },
  ],
};

const TRAIL = {
  user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
  date: TODAY,
  shifts: [
    {
      id: '01a10000-0000-7000-8000-0000000000c1',
      startedAt: before(120),
      endedAt: null,
      source: 'points',
      points: [
        { lat: 28.6315, lng: 77.2167, at: before(110) },
        { lat: 28.6355, lng: 77.2167, at: before(60) },
      ],
      distanceM: 2400,
      gaps: [{ from: before(110), to: before(60) }],
      pauses: [],
    },
  ],
  visits: [
    {
      id: '01a10000-0000-7000-8000-0000000000e9',
      account: SHOP,
      location: { lat: 28.6315, lng: 77.2167 },
      checkInAt: before(10),
      checkOutAt: null,
      geofence: 'outside',
      distanceM: 640,
    },
  ],
};

const full = <T,>(rows: T[]) => ({
  pass: 'full' as const,
  first: true,
  done: true,
  rows,
  removed: [],
});

function fakeClient(permissions: string[] = ['submission.review']) {
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
        if (method === 'GET' && url.startsWith('/v1/approvals/inbox')) {
          return { items: [APPROVAL], nextCursor: null, counts: { new_account: 1 } };
        }
        if (method === 'POST' && url === `/v1/approvals/${REQUEST}/decision`) {
          const body = (options as { body: { decision: string } }).body;
          return { ...APPROVAL, status: body.decision === 'approve' ? 'approved' : 'rejected' };
        }
        if (method === 'GET' && url === '/v1/live') return LIVE;
        if (method === 'GET' && url.startsWith('/v1/trails?')) {
          return url.includes(`date=${YESTERDAY}`) ? { ...TRAIL, shifts: [], visits: [] } : TRAIL;
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
        access: { role: 'manager', scope: 'team', permissions },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

type Page = 'team' | 'item' | 'day' | 'approval';

function Shown({ page }: { page: Page }) {
  const { session, restored } = useApp();
  if (!restored || !session) return null;
  if (page === 'day') return <PersonDayScreen userId={RAHUL} />;
  if (page === 'approval') return <ApprovalItemScreen id={REQUEST} />;
  return page === 'team' ? <TeamScreen /> : <ReviewItemScreen id={CLEAN} />;
}

async function renderPhone(page: Page, permissions?: string[]) {
  const fake = fakeClient(permissions);
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

describe('approvals in the Team tab (M15, D76)', () => {
  it('lists the requests waiting for the manager, and opens one', async () => {
    await renderPhone('team', ['approval.act']);
    expect(await screen.findByText('1 request to decide')).toBeOnTheScreen();
    expect(screen.queryByText(/to review/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /New accounts? · Rahul Verma/ }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/approvals/[id]',
      params: { id: REQUEST },
    });
  });

  it('shows the chain, rejects only with a reason, and approves at the version it saw', async () => {
    const client = await renderPhone('approval', ['approval.act']);
    expect(await screen.findByText('Gupta Kirana (C-2)')).toBeOnTheScreen();
    expect(screen.getByText('Approved by the same person at an earlier step')).toBeOnTheScreen();
    expect(screen.getByText('Waiting for Meena Shah')).toBeOnTheScreen();
    expect(screen.getByText('Escalated')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Reject' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reject' }));
    expect(
      await screen.findByText('At least 3 characters. The person who asked sees this.'),
    ).toBeOnTheScreen();
    const decisions = () =>
      client.request.mock.calls.filter(([, path]) => String(path).endsWith('/decision'));
    expect(decisions()).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/team'));
    expect(decisions()[0]?.[3]).toEqual({
      body: { decision: 'approve', version: 2 },
      idempotencyKey: expect.any(String),
    });
  });
});

describe('the team on a map (M17)', () => {
  it('lists who is on duty, flags whoever went quiet, and opens a person’s day', async () => {
    await renderPhone('team', ['live_map.view', 'trail.view']);
    const rahul = await screen.findByRole('button', { name: /Rahul Verma/ });
    expect(rahul).toHaveTextContent(/Seen 4 minutes ago · At Sharma Stores/);
    expect(screen.getByRole('button', { name: /Kavya Iyer/ })).toHaveTextContent(
      /Not seen for 15 minutes · Paused/,
    );
    expect(screen.getByLabelText('Map of the people on duty')).toBeOnTheScreen();
    // Without review rights, the queue isn't asked for.
    expect(screen.queryByText(/to review/)).toBeNull();
    await fireEvent.press(rahul);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/day/[id]', params: { id: RAHUL } });
  });

  it('shows a person’s day with its distance, gaps and visits, a day at a time', async () => {
    await renderPhone('day', ['live_map.view', 'trail.view']);
    expect(await screen.findByText('1 shift, 2.4 km, 1 visits.')).toBeOnTheScreen();
    expect(screen.getByText(/^No location from/)).toBeOnTheScreen();
    expect(screen.getByText('Sharma Stores')).toBeOnTheScreen();
    expect(screen.getByText(/ · Outside the geofence$/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Nothing that day')).toBeOnTheScreen();
  });
});
