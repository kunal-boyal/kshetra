import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Evidence review (M7) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const PHOTO = '01a10000-0000-7000-8000-0000000000f1';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
    form: {
      key: 'shop_visit',
      version: 1,
      name: {
        en: { one: 'Shop visit', other: 'Shop visits' },
        hi: { one: 'दुकान विज़िट', other: 'दुकान विज़िट' },
      },
    },
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
    autoApproveAt: '2026-10-14T06:00:05.000Z',
    reviews: [],
    ...overrides,
  };
}

/** A grey square, as a stored thumbnail stands in. */
const THUMBNAIL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/reviews/queue': {
    items: [
      item('01a10000-0000-7000-8000-0000000000e1'),
      item('01a10000-0000-7000-8000-0000000000e2', {
        geofence: 'outside',
        distanceM: 640,
        flags: ['outside_geofence', 'gallery_photo'],
        integrityWarning: true,
        autoApproveAt: null,
        reviews: [
          {
            decision: 'rejected',
            note: 'Photo of another shop',
            reviewer: { id: '01a10000-0000-7000-8000-000000000003', name: 'Priya Nair' },
            auto: false,
            at: '2026-10-13T08:00:00.000Z',
          },
        ],
      }),
    ],
    nextCursor: null,
  },
  '/v1/review-rules': { autoApproval: true, delayHours: 24 },
  [`/v1/media/${PHOTO}/url`]: {
    url: `${ORIGIN}/objects/photo.png`,
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
};

async function mockSignedIn(page: Page) {
  await page.route('**/objects/photo.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: THUMBNAIL }),
  );
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
          permissions: [
            'user.view',
            'account.view',
            'submission.review',
            'submission.review_bulk',
            'review_rules.manage',
          ],
        },
      },
    }),
  );
  for (const prefix of ['reviews', 'review-rules', 'media']) {
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

test('/review shows the queue with its evidence and rules, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible();
  await expect(page.getByText('Shelf restocked').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Photo 1' }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Automatic approval' })).toBeVisible();
  await expectAccessible(page);
});

test('/review passes axe in the outdoor theme, while rejecting', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/review');
  await page.getByRole('button', { name: 'Reject' }).first().click();
  await expect(page.getByRole('textbox', { name: /Why/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select for bulk approval' }).first().check();
  await expect(page.getByRole('button', { name: 'Approve 1 selected' })).toBeVisible();
  await expectAccessible(page);
});
