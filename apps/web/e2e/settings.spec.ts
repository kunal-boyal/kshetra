import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Tenant administration (M2) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

/** What the cell answers to a GET, by path. */
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const TYPE_ID = '01a10000-0000-7000-8000-000000000301';
const ANSWERS: Record<string, unknown> = {
  '/v1/organisation': { name: 'Sunrise Traders', logo: null },
  '/v1/account-types': {
    items: [
      {
        id: TYPE_ID,
        version: 1,
        key: 'customer',
        name: noun('Customer', 'Customers'),
        icon: 'store',
        active: true,
        parentTypes: [],
        code: { mode: 'auto', prefix: 'C' },
        fields: [
          { key: 'gst_number', type: 'short_text', label: { en: 'GST number', hi: 'GST नंबर' } },
        ],
        location: { required: true, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
        creation: 'admins',
        slots: [
          {
            key: 'executive',
            name: { en: 'Executive', hi: 'एग्ज़ीक्यूटिव' },
            designations: ['executive'],
            required: false,
            priority: 1,
          },
        ],
        segmentRules: [
          {
            segment: 'registered',
            name: { en: 'Registered', hi: 'पंजीकृत' },
            when: { match: 'all', clauses: [{ field: 'gst_number', op: 'is_not_empty' }] },
          },
        ],
        visitFrequencyNorms: [{ segment: 'registered', visitsPerMonth: 4 }],
        contacts: true,
      },
    ],
  },
  '/v1/designations': {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000051',
        key: 'executive',
        name: noun('Executive', 'Executives'),
        level: 3,
        ranked: true,
        defaultRole: 'field_user',
        canHaveReports: false,
      },
    ],
  },
  '/v1/roles': { items: [{ key: 'manager', name: { en: 'Manager', hi: 'मैनेजर' } }] },
  '/v1/forms': { items: [] },
  '/v1/territories': {
    items: [],
    levels: [
      { level: 1, key: 'region', name: noun('Region', 'Regions') },
      { level: 2, key: 'area', name: noun('Area', 'Areas') },
    ],
  },
  '/v1/metric-definitions': {
    metrics: [
      {
        active: true,
        version: 1,
        definition: {
          key: 'visits',
          name: noun('Visit', 'Visits'),
          unit: 'count',
          direction: 'higher_is_better',
          targetable: true,
          source: { type: 'plan_compliance_percent' },
        },
      },
    ],
    score: {
      periodType: 'month',
      cap: 1,
      rankingGroupBy: 'designation',
      metrics: [{ metric: 'visits', weight: 100 }],
    },
  },
  '/v1/terminology': {
    overrides: {
      'term.account': {
        en: { one: 'Customer', other: 'Customers' },
        hi: { one: 'ग्राहक', other: 'ग्राहक' },
      },
    },
  },
};

async function mockSignedIn(page: Page, brandColour: string | null = null) {
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
          brandColour,
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
            'settings.manage',
            'terminology.manage',
            'module.manage',
            'territory.manage',
            'metric.manage',
          ],
        },
      },
    }),
  );
  for (const prefix of [
    'organisation',
    'terminology',
    'account-types',
    'designations',
    'roles',
    'forms',
    'territories',
    'metric-definitions',
  ]) {
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

for (const path of [
  'organisation',
  'rules',
  'terminology',
  'modules',
  'account-types',
  'account-types/new',
  `account-types/${TYPE_ID}`,
  'territory-levels',
  'metrics',
  'metrics/visits',
  'metrics/new',
]) {
  for (const theme of ['light', 'outdoor']) {
    test(`/settings/${path} passes axe in the ${theme} theme`, async ({ page }) => {
      await mockSignedIn(page);
      await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
      await page.goto(`/settings/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
}

test("takes the tenant's accent from its brand colour", async ({ page }) => {
  await mockSignedIn(page, '#0f6e6e');
  await page.goto('/settings/organisation');
  await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible();
  const accent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
  await expect.poll(accent).toBe('#0f6e6e');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect.poll(accent).not.toBe('#0f6e6e');
  await expectAccessible(page);
});
