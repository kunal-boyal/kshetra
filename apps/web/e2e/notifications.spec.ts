import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Notifications (M16) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

const INBOX = {
  items: [
    {
      id: '01a10000-0000-7000-8000-0000000000d1',
      event: 'approval.waiting',
      category: 'approvals',
      values: { name: 'Asha Rao' },
      link: '/approvals',
      readAt: null,
      createdAt: '2026-10-16T05:00:00.000Z',
    },
    {
      id: '01a10000-0000-7000-8000-0000000000d2',
      event: 'tracking.stopped_report',
      category: 'tracking',
      values: { name: 'Ravi Kumar' },
      link: null,
      readAt: '2026-10-16T04:30:00.000Z',
      createdAt: '2026-10-16T04:00:00.000Z',
    },
  ],
  nextCursor: null,
  unread: 1,
};

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/notifications': INBOX,
  '/v1/whatsapp-consent': {
    optedIn: true,
    version: 1,
    at: '2026-10-20T05:00:00.000Z',
    currentVersion: 1,
    available: true,
  },
  '/v1/notification-prefs': {
    categories: [
      { category: 'plan', muted: false, mutable: true },
      { category: 'approvals', muted: false, mutable: false },
      { category: 'review', muted: true, mutable: true },
      { category: 'targets', muted: false, mutable: true },
      { category: 'tracking', muted: false, mutable: false },
      { category: 'imports', muted: false, mutable: true },
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
          targetUnlockByAdmin: true,
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
          permissions: ['performance.view_team', 'leaderboard.view', 'user.view'],
        },
      },
    }),
  );
  for (const prefix of ['notifications', 'notification-prefs', 'whatsapp-consent']) {
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

test('/notifications shows the inbox and preferences, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Asha Rao sent a request for you to decide.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications, 1 unread' })).toBeVisible();
  await expectAccessible(page);
});

test('/notifications passes axe in the outdoor theme', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/notifications');
  await expect(page.getByRole('checkbox', { name: /Approvals/ })).toBeDisabled();
  await expectAccessible(page);
});
