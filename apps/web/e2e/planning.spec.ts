import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Journey plans (M8) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const MANAGER = '01a10000-0000-7000-8000-000000000003';
const SHOP = '01a10000-0000-7000-8000-000000000080';
const MONTH = new Date().toISOString().slice(0, 7);
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

const SHOP_ACCOUNT = {
  id: SHOP,
  type: 'customer',
  code: 'C-80',
  name: 'Sharma Stores',
  territory: { id: '01a10000-0000-7000-8000-000000000010', code: 'N-DEL', name: 'Delhi' },
  parent: null,
  address: {},
  location: null,
  geofenceRadiusM: null,
  locationStatus: 'unverified',
  status: 'active',
  segments: [],
  custom: {},
  slots: [],
  primarySlot: null,
  missingSlots: [],
  outstanding: null,
  createdAt: '2026-10-01T07:00:00.000Z',
  updatedAt: '2026-10-01T07:00:00.000Z',
};

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  [`/v1/users/${RAHUL}`]: {
    id: RAHUL,
    code: 'SUN-004',
    name: 'Rahul Verma',
    phone: null,
    email: null,
    designation: 'executive',
    role: 'field_user',
    managerId: MANAGER,
    manager: { id: MANAGER, code: 'SUN-003', name: 'Priya Nair' },
    joiningDate: '2026-04-01',
    exitDate: null,
    status: 'active',
    territories: [],
    custom: {},
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:00:00.000Z',
    device: null,
  },
  '/v1/plan-items': {
    items: ['planned', 'visited', 'completed', 'missed', 'cancelled'].map((status, index) => ({
      id: `01a10000-0000-7000-8000-0000000000c${index}`,
      userId: RAHUL,
      account: { id: SHOP, code: 'C-80', name: 'Sharma Stores' },
      date: `${MONTH}-1${index}`,
      purpose: index === 0 ? 'Collect payment' : null,
      note: null,
      status,
      source: index === 0 ? 'adhoc' : 'route',
      routeId: null,
      visitId: null,
    })),
    approval: { status: 'submitted', approvalId: null },
  },
  '/v1/routes': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000b1',
        userId: RAHUL,
        name: 'Market road',
        recurrence: { kind: 'weekdays', days: [1, 4] },
        accounts: [{ id: SHOP, code: 'C-80', name: 'Sharma Stores' }],
        active: true,
      },
    ],
  },
  '/v1/accounts': { items: [SHOP_ACCOUNT], nextCursor: null, summary: null },
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
          permissions: ['user.view', 'account.view', 'plan_item.manage', 'route.manage'],
        },
      },
    }),
  );
  for (const prefix of ['users', 'plan-items', 'routes', 'accounts']) {
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

test('a person’s plan shows the month and routes, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto(`/people/${RAHUL}/plan`);
  await expect(page.getByRole('heading', { level: 1, name: "Rahul Verma's plan" })).toBeVisible();
  await expect(page.getByText('Collect payment')).toBeVisible();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expectAccessible(page);
});

test('a person’s plan passes axe in the outdoor theme, while adding a route', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto(`/people/${RAHUL}/plan`);
  await page.getByRole('button', { name: 'Add a route' }).click();
  await expect(page.getByRole('form', { name: 'Add a route' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel visit' }).first().click();
  await expect(page.getByRole('group', { name: /Cancel the visit/ })).toBeVisible();
  await expectAccessible(page);
});
