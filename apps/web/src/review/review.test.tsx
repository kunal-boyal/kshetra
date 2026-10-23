import { ApiError } from '@thelamp/api-client';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';

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
    values: { notes: 'Shelf restocked', open: true },
    photos: [PHOTO],
    signatureMediaId: null,
    flags: [],
    status: 'pending',
    autoApproved: false,
    photoDetails: [
      {
        id: PHOTO,
        source: 'camera',
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

type Answer = (body: unknown) => unknown;

function fakeClient(writes: Record<string, Answer> = {}, permissions: string[] = []) {
  const pages: Record<string, unknown> = {
    '/v1/reviews/queue': {
      items: [
        item(CLEAN),
        item(FLAGGED, {
          geofence: 'outside',
          distanceM: 640,
          flags: ['outside_geofence'],
          integrityWarning: true,
        }),
      ],
      nextCursor: null,
    },
    '/v1/review-rules': { autoApproval: false, delayHours: 24 },
    [`/v1/media/${PHOTO}/url`]: {
      url: 'https://objects.test/photo.jpg',
      expiresAt: '2026-10-13T07:00:00.000Z',
    },
  };
  const request = vi.fn(
    async (
      method: string,
      path: string,
      _schema: unknown,
      options: { body?: unknown; idempotencyKey?: string } = {},
    ) => {
      const bare = path.split('?')[0]!;
      if (method === 'GET') {
        if (path in pages) return pages[path];
        if (bare in pages) return pages[bare];
        throw new ApiError(404, 'NOT_FOUND', `Nothing at ${path}`);
      }
      const answer = writes[`${method} ${bare}`];
      if (!answer) throw new ApiError(404, 'NOT_FOUND', `Nothing at ${method} ${path}`);
      return answer(options.body);
    },
  );
  return {
    request,
    session: { tenant: TENANT, accessToken: 'a1', accessTokenExpiresAt: '' },
    restore: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    switchTenant: vi.fn(),
    me: vi.fn(async () => ({
      userId: MANAGER,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-003',
      name: 'Priya Nair',
      designation: 'manager',
      role: 'manager',
      scope: 'team',
      permissions: [],
      deviceId: null,
    })),
    config: vi.fn(async () => ({
      status: 'fresh',
      etag: '"1-role"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        forms: [],
        access: {
          role: 'manager',
          scope: 'team',
          permissions: ['submission.review', ...permissions],
        },
      },
    })),
  };
}

function renderAt(path: string, client: ReturnType<typeof fakeClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ client: client as unknown as WebClient, queryClient });
  const memory = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={memory} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const writes = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls.filter(([method]) => method !== 'GET');

const decided = (status: string) => () => item(CLEAN, { status });

describe('the review queue', () => {
  it('shows each submission with where it was filled, its photos, flags and warnings', async () => {
    renderAt('/review', fakeClient());
    const [first, second] = await screen.findAllByRole('article', {
      name: 'Shop visit, Rahul Verma',
    });
    expect(first).toHaveTextContent('Sharma Stores');
    expect(first).toHaveTextContent('Inside, 40 m');
    expect(first).toHaveTextContent('Shelf restocked');
    expect(first).toHaveTextContent('Yes');
    expect(first).toHaveTextContent('Camera');
    expect(first).toHaveTextContent('12 m from where the form was filled');
    expect(await within(first!).findByRole('img', { name: 'Photo 1' })).toHaveAttribute(
      'src',
      'https://objects.test/photo.jpg',
    );
    expect(second).toHaveTextContent('Outside, 640 m away');
    expect(second).toHaveTextContent('Outside the geofence');
    expect(second).toHaveTextContent('Phone failed its integrity check');
  });

  it('shows where a form was filled on a map when asked', async () => {
    renderAt('/review', fakeClient());
    const [first] = await screen.findAllByRole('article', { name: 'Shop visit, Rahul Verma' });
    const user = userEvent.setup();
    const show = within(first!).getByRole('button', { name: 'Show on map' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await user.click(show);
    expect(within(first!).getByRole('img', { name: 'Where the form was filled' })).toBeVisible();
    await user.click(within(first!).getByRole('button', { name: 'Hide map' }));
    expect(within(first!).queryByRole('img', { name: 'Where the form was filled' })).toBeNull();
  });

  it('approves at once, and rejects only with a reason', async () => {
    const client = fakeClient({
      [`POST /v1/submissions/${CLEAN}/review`]: decided('approved'),
    });
    renderAt('/review', client);
    const user = userEvent.setup();
    const [first] = await screen.findAllByRole('article');
    await user.click(within(first!).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(writes(client)).toEqual([
        [
          'POST',
          `/v1/submissions/${CLEAN}/review`,
          expect.anything(),
          { body: { decision: 'approved' }, idempotencyKey: expect.any(String) },
        ],
      ]),
    );

    await user.click(within(first!).getByRole('button', { name: 'Reject' }));
    expect(writes(client)).toHaveLength(1);
    await user.type(within(first!).getByRole('textbox', { name: /Why/ }), 'Photo of another shop');
    await user.click(within(first!).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(writes(client)[1]).toEqual([
        'POST',
        `/v1/submissions/${CLEAN}/review`,
        expect.anything(),
        {
          body: { decision: 'rejected', note: 'Photo of another shop' },
          idempotencyKey: expect.any(String),
        },
      ]),
    );
  });

  it('approves in bulk only what has no flags, after asking', async () => {
    const client = fakeClient(
      { 'POST /v1/reviews/bulk': () => ({ approved: [CLEAN], skipped: [] }) },
      ['submission.review_bulk'],
    );
    renderAt('/review', client);
    const user = userEvent.setup();
    const [first, second] = await screen.findAllByRole('article');
    expect(within(second!).queryByRole('checkbox')).toBeNull();
    await user.click(within(first!).getByRole('checkbox', { name: 'Select for bulk approval' }));
    await user.click(screen.getByRole('button', { name: 'Approve 1 selected' }));
    const question = screen.getByRole('group', { name: 'Approve 1 submission?' });
    expect(writes(client)).toEqual([]);
    await user.click(within(question).getByRole('button', { name: 'Approve 1 selected' }));
    expect(await screen.findByText('1 approved.')).toBeInTheDocument();
    expect(writes(client)).toEqual([
      [
        'POST',
        '/v1/reviews/bulk',
        expect.anything(),
        { body: { ids: [CLEAN] }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('lets those who set the rules turn on automatic approval with its delay', async () => {
    const client = fakeClient({ 'PUT /v1/review-rules': (body) => body }, ['review_rules.manage']);
    renderAt('/review', client);
    const user = userEvent.setup();
    const rules = await screen.findByRole('region', { name: 'Automatic approval' });
    await user.click(
      await within(rules).findByRole('checkbox', {
        name: /Approve automatically the forms set to automatic review/,
      }),
    );
    const delay = within(rules).getByRole('spinbutton', { name: 'Wait before approving (hours)' });
    await user.clear(delay);
    await user.type(delay, '12');
    await user.click(within(rules).getByRole('button', { name: 'Save' }));
    expect(await within(rules).findByText(/Saved\./)).toBeInTheDocument();
    expect(writes(client)).toEqual([
      [
        'PUT',
        '/v1/review-rules',
        expect.anything(),
        { body: { autoApproval: true, delayHours: 12 }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });
});
