import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Forms and the catalogue (spec 5.6, 5.11) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const VISIT = '01a10000-0000-7000-8000-0000000000a0';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const text = (en: string) => ({ en, hi: en });

const SHOP_TYPE = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'shop',
  name: noun('Shop', 'Shops'),
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [],
  location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'admins_only',
  slots: [],
  segmentRules: [],
  visitFrequencyNorms: [],
  contacts: false,
};

const VISIT_FORM = {
  id: VISIT,
  version: 2,
  active: true,
  key: 'shop_visit',
  name: noun('Shop visit', 'Shop visits'),
  icon: 'clipboard-list',
  tags: [],
  accountLink: { mode: 'required', accountTypes: ['shop'] },
  visitSession: true,
  shift: 'required',
  photos: { min: 1, max: 3, source: 'camera' },
  signature: 'none',
  geofence: 'inherit',
  review: 'manual',
  fields: [
    { key: 'stock_ok', type: 'yes_no', label: text('Stock is fine'), required: true },
    {
      key: 'shortfall',
      type: 'long_text',
      label: text('What is short'),
      required: false,
      visibleWhen: { match: 'all', clauses: [{ field: 'stock_ok', op: 'eq', value: false }] },
    },
    {
      key: 'lines',
      type: 'product_lines',
      label: text('Items seen'),
      required: false,
      maxLines: 50,
    },
    {
      key: 'packs_seen',
      type: 'calculated',
      label: text('Packs seen'),
      formula: 'round(lines * 1.5, 1)',
      result: 'number',
      decimals: 1,
    },
  ],
};

const ANSWERS: Record<string, unknown> = {
  '/v1/forms': { items: [VISIT_FORM] },
  '/v1/roles': { items: [] },
  '/v1/designations': { items: [] },
  '/v1/catalogue': {
    version: 3,
    units: [
      { key: 'pack', name: noun('Pack', 'Packs'), base: true },
      { key: 'case', name: noun('Case', 'Cases'), base: false },
    ],
    measureTypes: ['kg', 'L'],
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000b0',
        code: 'NEEM-500',
        name: 'Neem Shield 500 ML',
        product: { id: '01a10000-0000-7000-8000-0000000000b1', name: 'Neem Shield' },
        category: { id: '01a10000-0000-7000-8000-0000000000b2', name: 'Bio pesticides' },
        packLabel: '500 ML',
        hsn: '3808',
        taxRate: '18.0000',
        mrp: '450.00',
        baseUnit: 'pack',
        units: [
          { key: 'pack', factor: '1.000' },
          { key: 'case', factor: '20.000' },
        ],
        measureType: 'L',
        measurePerBaseUnit: '0.500000',
        custom: {},
        active: true,
      },
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
        accountTypes: [SHOP_TYPE],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['settings.manage', 'form.manage', 'catalogue.manage', 'import.run'],
        },
      },
    }),
  );
  for (const prefix of ['forms', 'roles', 'designations', 'catalogue']) {
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
  { path: '/settings/forms', heading: 'Forms', shows: 'Shop visit' },
  { path: '/settings/forms/new', heading: 'New form', shows: 'About the form' },
  { path: `/settings/forms/${VISIT}`, heading: 'Shop visit', shows: 'What is short' },
  { path: '/settings/catalogue', heading: 'Catalogue', shows: 'Neem Shield 500 ML' },
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

test("a field's settings and its condition pass axe", async ({ page }) => {
  await mockSignedIn(page);
  await page.goto(`/settings/forms/${VISIT}`);
  const fields = page.getByRole('list', { name: 'Fields' });
  await fields.getByRole('button', { name: /^What is short/ }).click();
  const field = page.getByRole('region', { name: 'Field What is short' });
  await expect(field.getByRole('group', { name: 'Show only when' })).toBeVisible();
  await expectAccessible(page);
  await fields.getByRole('button', { name: /^Items seen/ }).click();
  const lines = page.getByRole('region', { name: 'Field Items seen' });
  await expect(lines.getByRole('textbox', { name: 'Most lines' })).toBeVisible();
  // A calculated field's formula, read back as a sentence (D118).
  await fields.getByRole('button', { name: /^Packs seen/ }).click();
  const packs = page.getByRole('region', { name: 'Field Packs seen' });
  await expect(packs.getByText('Reads as: Items seen × 1.5, rounded to 1 place')).toBeVisible();
  await expectAccessible(page);
  // The phone preview beside the panes.
  await page.getByRole('button', { name: 'Preview on a phone' }).click();
  await expect(page.getByRole('region', { name: 'On the phone' })).toBeVisible();
  await expectAccessible(page);
});
