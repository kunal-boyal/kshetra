import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Performance and the leaderboard (M9) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const MONTH = new Date().toISOString().slice(0, 7);
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const person = (id: string, name: string) => ({ id, code: `SUN-${id.slice(-3)}`, name });

const METRICS = [
  ['calls', 'Call', 'count', true],
  ['amount', 'Sale', 'currency', true],
  ['reach', 'Coverage', 'percent', true],
  ['order_value', 'Order', 'currency', false],
].map(([key, one, unit, available]) => ({
  key,
  name: noun(String(one), `${String(one)}s`),
  unit,
  direction: 'higher_is_better',
  targetable: true,
  available,
  weight: key === 'calls' || key === 'amount' ? 50 : null,
}));

const figures = (
  actual: string | null,
  target: string | null = null,
  pending: string | null = null,
) => ({
  actual,
  pending,
  target,
  attainment: actual !== null && target !== null ? Number(actual) / Number(target) : null,
});

const ASHA_FIGURES = {
  calls: figures('2', '4', '1'),
  amount: figures('150.5', '301'),
  reach: figures('50'),
  order_value: figures(null),
};

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/performance/team': {
    period: MONTH,
    metrics: METRICS,
    rows: [
      {
        user: person(ASHA, 'Asha Rao'),
        designation: 'executive',
        territory: { code: 'IND-W', name: 'Indore West' },
        figures: ASHA_FIGURES,
        score: 50,
        rank: 2,
        previousRank: 3,
      },
      {
        user: person(RAVI, 'Ravi Kumar'),
        designation: 'executive',
        territory: null,
        figures: { calls: figures('1') },
        score: null,
        rank: null,
        previousRank: null,
      },
    ],
    totals: { calls: figures('3', '4', '1'), amount: figures('150.5', '301') },
  },
  '/v1/performance': {
    period: MONTH,
    user: person(ASHA, 'Asha Rao'),
    territory: { code: 'IND-W', name: 'Indore West' },
    metrics: METRICS,
    figures: ASHA_FIGURES,
    locked: true,
    score: 50,
    rank: 2,
    previousRank: 2,
    group: { key: 'executive', name: noun('Executive', 'Executives'), size: 2 },
    days: [{ date: `${MONTH}-02`, values: { calls: '2', amount: '150.5' } }],
  },
  '/v1/leaderboard': {
    period: MONTH,
    groups: [
      { key: 'executive', name: noun('Executive', 'Executives'), size: 2 },
      { key: 'manager', name: noun('Manager', 'Managers'), size: 1 },
    ],
    group: 'executive',
    metrics: METRICS,
    rows: [
      {
        user: person(RAVI, 'Ravi Kumar'),
        territory: { code: 'IND-E', name: 'Indore East' },
        figures: { calls: figures('4', '4'), amount: figures('301', '301') },
        score: 100,
        rank: 1,
        previousRank: 2,
        you: false,
      },
      {
        user: person(ASHA, 'Asha Rao'),
        territory: { code: 'IND-W', name: 'Indore West' },
        figures: ASHA_FIGURES,
        score: 50,
        rank: 2,
        previousRank: 1,
        you: true,
      },
    ],
  },
  '/v1/submissions': { items: [], nextCursor: null },
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
  for (const prefix of ['performance', 'leaderboard', 'submissions']) {
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

const PAGES = [
  { path: '/performance', heading: /^Performance · /, shows: 'Asha Rao' },
  { path: `/performance/${ASHA}`, heading: 'Asha Rao’s month', shows: '+1 pending' },
  { path: '/leaderboard', heading: /^Leaderboard · /, shows: 'Ravi Kumar' },
];

for (const { path, heading, shows } of PAGES) {
  test(`${path} shows its data and passes axe`, async ({ page }) => {
    await mockSignedIn(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    await expectAccessible(page);
  });
}

test('performance and the leaderboard pass axe in the outdoor theme', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto(`/performance/${ASHA}`);
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expectAccessible(page);
  await page.goto('/leaderboard');
  await expect(page.getByRole('group', { name: 'Group' })).toBeVisible();
  await expectAccessible(page);
});

test('wide tables scroll in their own box, never the page (decision D104)', async ({ page }) => {
  await mockSignedIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/performance', '/leaderboard']) {
    await page.goto(path);
    await expect(page.getByText('Ravi Kumar').first()).toBeVisible();
    const [page_, window_] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(page_, path).toBeLessThanOrEqual(window_);
  }
});
