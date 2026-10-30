import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** The home dashboard (M18) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const PERIOD = new Date().toISOString().slice(0, 7);
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const metric = (key: string, one: string, other: string, unit = 'count') => ({
  key,
  name: noun(one, other),
  unit,
  direction: 'higher_is_better',
  targetable: true,
  available: true,
  weight: null,
});

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/me': {
    userId: '01a10000-0000-7000-8000-000000000003',
    tenantId: TENANT.id,
    cell: 'local',
    code: 'SUN-003',
    name: 'Priya Nair',
    designation: 'manager',
    role: 'manager',
    scope: 'team',
    permissions: [],
    deviceId: null,
  },
  '/v1/dashboard': {
    period: PERIOD,
    view: 'team',
    people: 12,
    tiles: [
      {
        metric: metric('visits', 'Visit', 'Visits'),
        figures: { actual: '342', pending: '18', target: '480', attainment: 0.7125 },
      },
      {
        metric: metric('collection', 'Collection', 'Collections', 'currency'),
        figures: { actual: '412500', pending: null, target: '500000', attainment: 0.825 },
      },
      {
        metric: metric('new_accounts', 'New account', 'New accounts'),
        figures: { actual: '9', pending: '2', target: '15', attainment: 0.6 },
      },
    ],
    trend: [
      {
        key: 'visits',
        days: Array.from({ length: 20 }, (_, index) => ({
          date: `${PERIOD}-${String(index + 1).padStart(2, '0')}`,
          actual: [12, 18, 15, 0, 20, 22, 17, 14, 19, 0, 21, 23, 16, 18, 20, 0, 24, 19, 22, 17][
            index
          ]!,
          pending: index > 16 ? [3, 5, 4][index - 17]! : null,
        })),
      },
    ],
    mix: [
      {
        form: { key: 'shop_visit', name: noun('Shop visit', 'Shop visits') },
        approved: 280,
        pending: 18,
        rejected: 6,
      },
      {
        form: { key: 'stock_check', name: noun('Stock check', 'Stock checks') },
        approved: 96,
        pending: 4,
        rejected: 2,
      },
      {
        form: { key: 'collection', name: noun('Collection', 'Collections') },
        approved: 41,
        pending: 0,
        rejected: 1,
      },
    ],
    leaderboard: {
      group: { key: 'executive', name: noun('Executive', 'Executives') },
      rows: [
        {
          user: {
            id: '01a10000-0000-7000-8000-000000000004',
            code: 'SUN-004',
            name: 'Rahul Verma',
          },
          territory: { code: 'IND-W', name: 'Indore West' },
          score: 92,
          rank: 1,
          you: false,
        },
        {
          user: {
            id: '01a10000-0000-7000-8000-000000000005',
            code: 'SUN-005',
            name: 'Sneha Kulkarni',
          },
          territory: null,
          score: 88,
          rank: 2,
          you: false,
        },
      ],
    },
    onDuty: 9,
    onDutyPeople: [
      {
        user: { id: '01a10000-0000-7000-8000-000000000004', name: 'Rahul Verma' },
        place: 'Sharma Stores',
        visits: 3,
        paused: false,
        seenAt: new Date().toISOString(),
      },
      {
        user: { id: '01a10000-0000-7000-8000-000000000005', name: 'Sneha Kulkarni' },
        place: null,
        visits: 0,
        paused: true,
        seenAt: null,
      },
    ],
    onLeaveToday: 1,
    waiting: { reviews: 6, approvals: 2, plans: 0, leave: 1, expenses: 1 },
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
          permissions: [
            'submission.review',
            'approval.act',
            'live_map.view',
            'leaderboard.view',
            'performance.view_team',
          ],
        },
      },
    }),
  );
  for (const prefix of ['dashboard', 'me']) {
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

test('/ shows the team dashboard with its charts, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Your team of 12 this period' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Forms to review\s*6$/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'On duty now · 9 of 12' })).toBeVisible();
  await expect(
    page.getByRole('img', {
      name: 'Visits each day of this period, approved and waiting for review',
    }),
  ).toBeVisible();
  await expect(page.locator('[role="img"] svg').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/home-light.png', fullPage: true });
  await expectAccessible(page);
});

test('/ passes axe in the dark and outdoor themes', async ({ page }) => {
  await mockSignedIn(page);
  for (const theme of ['dark', 'outdoor']) {
    await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Forms this period' })).toBeVisible();
    await page.screenshot({ path: `test-results/home-${theme}.png`, fullPage: true });
    await expectAccessible(page);
  }
});

test('runs under its Content-Security-Policy, which nothing on the page breaks (D101)', async ({
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (line: string) => violations.push(line));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { reportViolation: (line: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      ),
    ),
  );
  await mockSignedIn(page);
  const reply = await page.goto('/');
  expect(reply?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.getByRole('region', { name: 'Your team of 12 this period' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('/security shows the authenticator and the sessions, and passes axe (D101)', async ({
  page,
}) => {
  await mockSignedIn(page);
  await page.route('**/auth/v1/authenticator', (route) =>
    route.fulfill({ json: { enrolled: false, required: false } }),
  );
  await page.route('**/auth/v1/sessions', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '01a10000-0000-7000-8000-00000000f001',
            kind: 'web',
            agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0 Safari/537.36',
            ip: '203.0.113.7',
            startedAt: '2026-10-27T04:00:00.000Z',
            lastUsedAt: '2026-10-27T05:00:00.000Z',
            current: true,
          },
          {
            id: '01a10000-0000-7000-8000-00000000f002',
            kind: 'phone',
            agent: 'okhttp/4.12.0',
            ip: '198.51.100.4',
            startedAt: '2026-10-20T04:00:00.000Z',
            lastUsedAt: '2026-10-26T05:00:00.000Z',
            current: false,
          },
        ],
      },
    }),
  );
  await page.goto('/security');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign-in security' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up an authenticator' })).toBeVisible();
  // Where the person is signed in, with the other session ready to end (D101).
  await expect(page.getByRole('table', { name: 'Where you’re signed in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out everywhere else' })).toBeVisible();
  await expectAccessible(page);
});
