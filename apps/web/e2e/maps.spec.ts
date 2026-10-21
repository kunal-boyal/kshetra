import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * Maps (M17) in the built portal, against a mocked API, with axe. The build has no Maps key, so
 * each map shows its notice; the lists, slider and table beside it are what these check.
 */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ASHA = '01a10000-0000-7000-8000-000000000004';
const SHOP = { id: '01a10000-0000-7000-8000-0000000000a1', code: 'C-1', name: 'Sharma Stores' };
const SHIFT = '01a10000-0000-7000-8000-0000000000c1';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const READ_AT = '2026-10-21T06:00:00.000Z';
const before = (minutes: number) => new Date(Date.parse(READ_AT) - minutes * 60_000).toISOString();

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/live': {
    readAt: READ_AT,
    people: [
      {
        user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
        shiftId: SHIFT,
        onDutySince: before(120),
        paused: false,
        position: { lat: 28.6315, lng: 77.2167 },
        accuracy: 12,
        battery: 80,
        seenAt: before(40),
        visit: { account: SHOP, checkInAt: before(45) },
      },
    ],
  },
  '/v1/account-pins': {
    period: '2026-10',
    items: [{ ...SHOP, type: 'customer', location: { lat: 28.6315, lng: 77.2167 }, visited: true }],
    truncated: false,
  },
  '/v1/trails': {
    user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
    date: '2026-10-21',
    shifts: [
      {
        id: SHIFT,
        startedAt: '2026-10-21T03:30:00.000Z',
        endedAt: '2026-10-21T11:30:00.000Z',
        source: 'points',
        points: [
          { lat: 28.6315, lng: 77.2167, at: '2026-10-21T03:35:00.000Z' },
          { lat: 28.6355, lng: 77.2167, at: '2026-10-21T04:35:00.000Z' },
        ],
        distanceM: 2400,
        gaps: [{ from: '2026-10-21T03:35:00.000Z', to: '2026-10-21T04:35:00.000Z' }],
        pauses: [{ from: '2026-10-21T07:00:00.000Z', to: '2026-10-21T07:30:00.000Z' }],
      },
    ],
    visits: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        account: SHOP,
        location: { lat: 28.6315, lng: 77.2167 },
        checkInAt: '2026-10-21T05:00:00.000Z',
        checkOutAt: '2026-10-21T05:20:00.000Z',
        geofence: 'inside',
        distanceM: 40,
      },
    ],
  },
  '/v1/density': {
    period: '2026-10',
    cell: 0.01,
    visits: 5,
    cells: [
      { lat: 28.631, lng: 77.216, visits: 4 },
      { lat: 28.701, lng: 77.1, visits: 1 },
    ],
  },
};

async function mockSignedIn(page: Page) {
  await page.route('**/auth/v1/token/refresh', (route) =>
    route.fulfill({
      json: {
        tenant: TENANT,
        session: {
          tokenType: 'Bearer',
          accessToken: 'access-token',
          accessTokenExpiresAt: later(),
          refreshTokenExpiresAt: later(),
        },
      },
    }),
  );
  await page.route('**/v1/config', (route) =>
    route.fulfill({
      headers: { etag: '"1-role"' },
      json: {
        version: 1,
        settings: {
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          defaultCountry: 'IN',
          languages: ['en', 'hi'],
          financialYearStartMonth: 4,
          brandColour: null,
          gpsIntervalSeconds: 60,
          geofenceRadiusMeters: 300,
          geofenceAccuracyCapMeters: 100,
          syncWindowHours: 72,
          maxShiftHours: 14,
          attendanceSelfie: false,
          deviceBinding: true,
          rawLocationRetentionDays: 35,
          trailRetentionDays: 365,
          evidencePhotoRetentionMonths: 12,
          reviewAutoApproval: false,
          journeyPlanApproval: false,
          targetUnlockByAdmin: false,
          ordersNeedOpenShift: true,
          ordersAllowedOffline: true,
          planNotificationTime: '08:00',
          quietHoursStart: '21:00',
          quietHoursEnd: '07:00',
        },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['user.view', 'account.view', 'live_map.view', 'trail.view'],
        },
      },
    }),
  );
  for (const prefix of ['live', 'account-pins', 'trails', 'density']) {
    await page.route(`**/v1/${prefix}**`, (route) => {
      const answer = ANSWERS[new URL(route.request().url()).pathname];
      return answer
        ? route.fulfill({ json: answer })
        : route.fulfill({
            status: 404,
            json: { error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'r' } },
          });
    });
  }
}

/** WCAG 2.1 A and AA, which every screen must pass. */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id} at ${node.target.join(' ')}: ${node.failureSummary}`,
    ),
  );
  expect(found).toEqual([]);
}

test('/live-map lists who is on duty, flags a stale position, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/live-map');
  await expect(page.getByRole('heading', { level: 1, name: 'Live map' })).toBeVisible();
  const list = page.getByRole('region', { name: 'People on duty' });
  await expect(list.getByText('Asha Rao')).toBeVisible();
  await expect(list.getByText('Not seen for 15 minutes')).toBeVisible();
  await expect(list.getByText('At Sharma Stores')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Map of the people on duty' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Show/ }).check();
  await expectAccessible(page);
});

test('/people/:id/replay replays the day, and passes axe in the outdoor theme', async ({
  page,
}) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto(`/people/${ASHA}/replay`);
  await expect(page.getByRole('heading', { level: 1, name: 'Asha Rao’s day' })).toBeVisible();
  await expect(page.getByText('1 shift, 2.4 km, 1 visits.')).toBeVisible();
  await expect(page.getByRole('slider', { name: /Where they were at/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Visits' })).toContainText('Inside the geofence');
  await expectAccessible(page);
});

test('/density lists the busiest places, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/density');
  await expect(page.getByRole('heading', { level: 1, name: 'Visit density' })).toBeVisible();
  await expect(page.getByText('5 visits across 2 places.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'The busiest places this month' })).toBeVisible();
  await expectAccessible(page);
});
