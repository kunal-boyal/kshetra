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
    geofenceAt: { location: { lat: 28.6318, lng: 77.2167 }, radiusM: 100 },
    ...overrides,
  };
}

const SUMMARY = {
  counts: { pending: 2, flagged: 1, clean: 1, approved: 7, rejected: 1 },
  autoApproval: true,
  delayHours: 48,
};

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
          geofenceAt: null,
          capturedAt: '2026-10-12T06:00:00.000Z',
        }),
      ],
      nextCursor: null,
      summary: SUMMARY,
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

describe('the review queue (M7, decision D104)', () => {
  it('heads the queue with its counts and auto-approval, and chips for each view', async () => {
    const client = fakeClient();
    renderAt('/review', client);
    expect(
      await screen.findByText('2 waiting · clean ones approve themselves after 48 hours'),
    ).toBeVisible();
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getByRole('button', { name: 'Waiting · 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.setup().click(within(chips).getByRole('button', { name: 'With flags · 1' }));
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(/^\/v1\/reviews\/queue\?status=pending&flagged=yes/),
        expect.anything(),
      ),
    );
  });

  it('lists the queue beside the chosen submission, with its flags, values, photos and map', async () => {
    renderAt('/review', fakeClient());
    const table = await screen.findByRole('table', { name: 'Submissions to review, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[0]).toHaveTextContent('Sharma Stores');
    // The worst flag leads the row, in danger; the rest are counted.
    expect(within(rows[1]!).getByText('Phone failed its integrity check')).toHaveClass(
      'ks-flag',
      'danger',
    );
    expect(within(rows[1]!).getByText('+1 more')).toHaveAttribute('title', 'Outside the geofence');

    const detail = screen.getByRole('complementary', { name: 'Shop visit, Rahul Verma' });
    expect(detail).toHaveTextContent('Inside, 40 m');
    expect(detail).toHaveTextContent('Shelf restocked');
    expect(within(detail).getByText('Inside, 40 m')).toHaveClass('ks-pill', 'inside');
    await waitFor(() =>
      expect(
        within(detail).getByRole('img', { name: /^Photo 1, Camera, .*12 m from where/ }),
      ).toHaveAttribute('src', 'https://objects.test/photo.jpg'),
    );
    expect(
      within(detail).getByRole('img', {
        name: 'Map: filled in 33 m from the account, whose geofence is 100 m',
      }),
    ).toBeVisible();
    expect(within(detail).getByLabelText('Note to Rahul')).toBeVisible();

    // The second has no verified place: no small map, and its flags in full.
    await userEvent.setup().click(within(rows[1]!).getByRole('button', { name: /Rahul Verma/ }));
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(detail).toHaveTextContent('Phone failed its integrity check');
    expect(within(detail).getByText('Phone failed its integrity check')).toHaveClass(
      'ks-flag',
      'danger',
    );
    expect(within(detail).queryByRole('img', { name: /^Map:/ })).toBeNull();
  });

  it('shows where a form was filled on the full map when asked', async () => {
    renderAt('/review', fakeClient());
    const show = await screen.findByRole('button', { name: 'Show on map' });
    await userEvent.setup().click(show);
    expect(screen.getByRole('button', { name: 'Hide map' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('approves the chosen submission, and moves on to the next', async () => {
    const client = fakeClient({ [`POST /v1/submissions/${CLEAN}/review`]: decided('approved') });
    renderAt('/review', client);
    const detail = await screen.findByRole('complementary');
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(writes(client)).toHaveLength(1));
    expect(writes(client)[0]![3]).toMatchObject({ body: { decision: 'approved' } });
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'));
  });

  it('shows why a rejection without a note was refused, beside the note', async () => {
    const client = fakeClient({
      [`POST /v1/submissions/${CLEAN}/review`]: () => {
        throw new ApiError(400, 'VALIDATION', 'Say why.', [
          { path: 'note', issue: 'Say why in at least 10 characters' },
        ]);
      },
    });
    renderAt('/review', client);
    const detail = await screen.findByRole('complementary');
    await userEvent.setup().click(within(detail).getByRole('button', { name: 'Reject' }));
    expect(await within(detail).findByText('Say why in at least 10 characters')).toBeVisible();
  });

  it('approves every clean waiting submission at once, after asking', async () => {
    const client = fakeClient(
      { 'POST /v1/reviews/bulk': () => ({ approved: [CLEAN], skipped: [] }) },
      ['submission.review_bulk'],
    );
    renderAt('/review', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve 1 clean' }));
    expect(screen.getByText('Approve 1 waiting submission without flags?')).toBeVisible();
    const confirm = screen.getByRole('group', {
      name: 'Approve 1 waiting submission without flags?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Approve 1 clean' }));
    await waitFor(() => expect(writes(client)).toHaveLength(1));
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringMatching(/^\/v1\/reviews\/queue\?status=pending&flagged=no&limit=100/),
      expect.anything(),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('1 approved.');
  });

  it('keeps the other filters behind More filters', async () => {
    renderAt('/review', fakeClient());
    const more = await screen.findByRole('button', { name: 'More filters' });
    expect(screen.queryByRole('combobox', { name: 'Form' })).toBeNull();
    await userEvent.setup().click(more);
    expect(screen.getByRole('combobox', { name: 'Form' })).toBeVisible();
    expect(screen.getByLabelText('Filled from')).toBeVisible();
  });

  it('says so when nothing waits, without a detail or a bulk approval', async () => {
    const client = fakeClient({}, ['submission.review_bulk']);
    const empty = {
      items: [],
      nextCursor: null,
      summary: {
        ...SUMMARY,
        counts: { pending: 0, flagged: 0, clean: 0, approved: 0, rejected: 0 },
      },
    };
    client.request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/v1/reviews/queue')) return empty;
      throw new ApiError(404, 'NOT_FOUND', path);
    });
    renderAt('/review', client);
    expect(await screen.findByText('Nothing to review')).toBeVisible();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /clean/ })).toBeNull();
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
