import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Imports and territories (M19, M4) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ADMIN = '01a10000-0000-7000-8000-000000000002';
const MAPPING = '01a10000-0000-7000-8000-000000000070';
const INVALID = '01a10000-0000-7000-8000-000000000071';
const NORTH = '01a10000-0000-7000-8000-000000000010';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

function job(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    target: 'users',
    fileName: 'people.csv',
    status: 'mapping',
    sheets: ['Notes', 'Staff'],
    sheet: 'Staff',
    headerRow: 3,
    headers: ['Emp code', 'Full name', 'Reports to'],
    mapping: { 'Emp code': 'code', 'Full name': 'name', 'Reports to': 'reports_to' },
    fields: [
      { key: 'code', required: true },
      { key: 'name', required: true },
      { key: 'reports_to', required: false },
      { key: 'custom.hq', required: false, label: { en: 'HQ', hi: 'मुख्यालय' } },
    ],
    totalRows: 2,
    skippedRows: null,
    errorRows: null,
    errors: [],
    preview: [],
    planned: null,
    created: null,
    updated: null,
    createdBy: ADMIN,
    createdAt: '2026-10-12T05:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const INVALID_JOB = job(INVALID, {
  fileName: 'october.xlsx',
  status: 'invalid',
  errorRows: 1,
  errors: [
    {
      row: 4,
      field: 'reports_to',
      issue: 'A Verma could be Asha Verma (OLD-1) or Anil Verma (OLD-2); write the code',
      value: 'A Verma',
    },
  ],
  skippedRows: 2,
  preview: [
    {
      row: 4,
      values: { code: 'S-2', name: 'Gita Field', reports_to: 'A Verma' },
      problems: ['A Verma could be Asha Verma (OLD-1) or Anil Verma (OLD-2); write the code'],
    },
    { row: 5, values: { code: 'S-3', name: 'Ravi Field', reports_to: 'S-1' }, problems: [] },
  ],
});

const ANSWERS: Record<string, unknown> = {
  '/v1/imports': { items: [INVALID_JOB, job(MAPPING, {})], nextCursor: null },
  [`/v1/imports/${MAPPING}`]: job(MAPPING, {}),
  [`/v1/imports/${INVALID}`]: INVALID_JOB,
  '/v1/territories': {
    items: [
      { id: NORTH, parentId: null, level: 1, code: 'NORTH', name: 'North', active: true },
      {
        id: '01a10000-0000-7000-8000-000000000011',
        parentId: NORTH,
        level: 2,
        code: 'N-DEL',
        name: 'Delhi',
        active: true,
      },
    ],
    levels: [
      { level: 1, key: 'region', name: noun('Region', 'Regions') },
      { level: 2, key: 'area', name: noun('Area', 'Areas') },
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
          permissions: ['user.view', 'user.manage', 'territory.manage', 'import.run'],
        },
      },
    }),
  );
  for (const prefix of ['imports', 'territories']) {
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
  { path: '/imports', heading: 'Imports', shows: 'october.xlsx' },
  { path: `/imports/${MAPPING}`, heading: 'People', shows: 'The headings are in row 3' },
  { path: `/imports/${INVALID}`, heading: 'People', shows: 'Nothing has been imported' },
  { path: '/territories', heading: 'Territories', shows: 'Delhi' },
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

test('the territory form and the outdoor theme pass axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/territories');
  await page.getByRole('button', { name: 'Edit Delhi' }).click();
  await expect(page.getByRole('combobox', { name: 'Parent' })).toBeVisible();
  await expectAccessible(page);
});
