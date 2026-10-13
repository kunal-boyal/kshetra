import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ADMIN = '01a10000-0000-7000-8000-000000000002';
const PRIYA = '01a10000-0000-7000-8000-000000000003';
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const DELHI = '01a10000-0000-7000-8000-000000000010';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

const DESIGNATIONS = [
  { key: 'head', name: noun('Head', 'Heads'), level: 1, ranked: false },
  { key: 'manager', name: noun('Manager', 'Managers'), level: 2, ranked: false },
  { key: 'executive', name: noun('Executive', 'Executives'), level: 3, ranked: true },
];

const SETTINGS = {
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
  targetUnlockByAdmin: false,
  ordersNeedOpenShift: true,
  ordersAllowedOffline: true,
};

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: `SUN-${id.slice(-3)}`,
    name,
    phone: '+919000000004',
    email: null,
    designation: 'executive',
    role: 'field_user',
    managerId: PRIYA,
    manager: { id: PRIYA, code: 'SUN-003', name: 'Priya Nair' },
    joiningDate: '2026-04-01',
    exitDate: null,
    status: 'active',
    territories: [{ id: DELHI, code: 'N-DEL', name: 'Delhi Area' }],
    custom: { hq: 'Karnal' },
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:00:00.000Z',
    device: null,
    ...overrides,
  };
}

const RAHUL_VIEW = person(RAHUL, 'Rahul Verma', {
  device: {
    id: '01a10000-0000-7000-8000-000000000020',
    platform: 'android',
    model: 'Field phone',
    osVersion: '15',
    appVersion: '0.2.0',
    boundAt: '2026-10-06T07:00:00.000Z',
    lastSeenAt: '2026-10-07T08:00:00.000Z',
    health: {
      appVersion: '0.2.0',
      osVersion: '15',
      permissions: {},
      batteryOptimised: true,
      queue: { queued: 2, parked: 1, oldestQueuedAt: null },
      lastSyncAt: '2026-10-07T08:00:00.000Z',
      receivedAt: '2026-10-07T08:00:00.000Z',
      clockSkewSeconds: 0,
    },
  },
});
const PRIYA_VIEW = person(PRIYA, 'Priya Nair', {
  designation: 'manager',
  role: 'manager',
  managerId: null,
  manager: null,
  territories: [],
  custom: {},
});

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/users': { items: [PRIYA_VIEW, RAHUL_VIEW], nextCursor: null },
  [`/v1/users/${RAHUL}`]: RAHUL_VIEW,
  [`/v1/users/${PRIYA}`]: PRIYA_VIEW,
  [`/v1/users/${RAHUL}/transfers`]: {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000060',
        userId: RAHUL,
        effectiveDate: '2030-01-15',
        changes: { designation: 'manager' },
        status: 'scheduled',
        reason: null,
        createdAt: '2026-10-07T08:00:00.000Z',
        createdBy: ADMIN,
        appliedAt: null,
        cancelledAt: null,
      },
    ],
  },
  [`/v1/users/${RAHUL}/history`]: {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000030',
        actor: { kind: 'system', id: null },
        action: 'user.created',
        target: { type: 'user', id: RAHUL },
        before: null,
        after: null,
        ip: null,
        deviceId: null,
        supportGrantId: null,
        createdAt: '2026-10-06T07:00:00.000Z',
      },
    ],
    nextCursor: null,
  },
  '/v1/org-chart': {
    items: [
      {
        id: PRIYA,
        code: 'SUN-003',
        name: 'Priya Nair',
        designation: 'manager',
        status: 'active',
        managerId: null,
        reports: 1,
        team: { executive: 1 },
      },
    ],
    totals: { manager: 1, executive: 1 },
  },
  '/v1/territories': {
    items: [
      { id: DELHI, parentId: null, level: 1, code: 'N-DEL', name: 'Delhi Area', active: true },
    ],
    levels: [{ level: 1, key: 'region', name: noun('Region', 'Regions') }],
  },
  '/v1/user-fields': {
    fields: [
      {
        key: 'hq',
        type: 'short_text',
        label: { en: 'HQ', hi: 'मुख्यालय' },
        required: false,
        maxLength: 200,
      },
    ],
    retired: [],
  },
  '/v1/roles': {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000040',
        key: 'field_user',
        name: { en: 'Field user', hi: 'फ़ील्ड यूज़र' },
        scope: 'self',
        permissions: ['shift.use'],
        mobileOnly: true,
        system: true,
      },
    ],
  },
  '/v1/designations': {
    items: DESIGNATIONS.map((designation, index) => ({
      ...designation,
      id: `01a10000-0000-7000-8000-00000000005${index}`,
      defaultRole: 'field_user',
      canHaveReports: designation.level < 3,
    })),
  },
};

/** Answers as the directory and cell would for an admin already signed in. */
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
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      json: {
        userId: ADMIN,
        tenantId: TENANT.id,
        cell: 'local',
        code: 'SUN-001',
        name: 'Anita Rao',
        designation: 'head',
        role: 'tenant_admin',
        scope: 'tenant',
        permissions: ['user.view', 'user.manage'],
        deviceId: null,
      },
    }),
  );
  await page.route('**/v1/config', (route) =>
    route.fulfill({
      headers: { etag: '"1-role"' },
      json: {
        version: 1,
        settings: SETTINGS,
        terminology: {},
        designations: DESIGNATIONS,
        accountTypes: [],
        forms: [],
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: [
            'user.view',
            'user.manage',
            'user.reset_device',
            'user.sign_out_all',
            'role.manage',
            'designation.manage',
            'settings.manage',
          ],
        },
      },
    }),
  );
  for (const prefix of [
    'users',
    'org-chart',
    'territories',
    'user-fields',
    'roles',
    'designations',
  ]) {
    await page.route(`**/v1/${prefix}**`, (route) => {
      const url = new URL(route.request().url());
      const answer = ANSWERS[url.pathname];
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
  { path: '/people', heading: 'People' },
  { path: `/people/${RAHUL}`, heading: 'Rahul Verma' },
  { path: '/people/new', heading: 'Add a person' },
  { path: `/people/${RAHUL}/edit`, heading: 'Edit Rahul Verma' },
  { path: `/people/${RAHUL}/transfer`, heading: 'Transfer Rahul Verma' },
  { path: '/org-chart', heading: 'Organisation chart' },
  { path: '/settings/roles', heading: 'Roles' },
  { path: '/settings/designations', heading: 'Designations' },
  { path: '/settings/people-fields', heading: 'People fields' },
];

for (const { path, heading } of PAGES) {
  test(`${path} shows its people data and passes axe`, async ({ page }) => {
    await mockSignedIn(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectAccessible(page);
  });
}

test('the people table passes axe in the outdoor theme, and opens a person', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/people');
  await expect(page.getByRole('row', { name: /Rahul Verma/ })).toContainText('Field phone');
  await expectAccessible(page);
  await page.getByRole('link', { name: /Rahul Verma/ }).click();
  await expect(page.getByRole('region', { name: 'Phone' })).toContainText('2 waiting, 1 refused');
  await expectAccessible(page);
});
