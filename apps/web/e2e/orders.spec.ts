import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Orders (M10, D78) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ORDER = '01a10000-0000-7000-8000-0000000000f0';
const SHOP = '01a10000-0000-7000-8000-000000000080';
const SME = '01a10000-0000-7000-8000-000000000004';
const NEEM = '01a10000-0000-7000-8000-0000000000b0';
const LIST = '01a10000-0000-7000-8000-0000000000c0';
const later = () => new Date(Date.now() + 3_600_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

const LINE = {
  id: '01a10000-0000-7000-8000-0000000000f1',
  position: 1,
  item: {
    id: NEEM,
    code: 'NEEM',
    name: 'Neem Shield 500 ML',
    packLabel: '500 ML',
    hsn: '3808',
    mrp: '450.00',
    baseUnit: 'pack',
  },
  unitKey: 'case',
  quantity: '2.000',
  factor: '12.000',
  baseUnits: '24.000',
  measureType: 'L',
  measure: '12.000',
  priceListId: LIST,
  price: '400.00',
  discount: '10.0000',
  taxRate: '18.0000',
  rate: '360.00',
  taxable: '8640.00',
  tax: '1555.20',
  total: '10195.20',
  decision: 'pending',
  decisionReason: null,
  fulfilledUnits: null,
};

const ANSWERS: Record<string, unknown> = {
  '/v1/orders': {
    items: [
      {
        id: ORDER,
        number: 1187,
        account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
        placedBy: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        placedAt: '2026-10-20T05:00:00.000Z',
        status: 'submitted',
        lineCount: 1,
        total: '10195.20',
      },
    ],
    nextCursor: null,
    summary: { counts: { submitted: 1 }, orders: 1, value: '10195.20' },
  },
  [`/v1/orders/${ORDER}`]: {
    id: ORDER,
    number: 1187,
    account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
    supplier: { kind: 'company', account: null },
    placedBy: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
    visitId: null,
    placedAt: '2026-10-20T05:00:00.000Z',
    receivedAt: '2026-10-20T05:00:03.000Z',
    note: null,
    photos: [],
    status: 'submitted',
    rejectionReason: null,
    lines: [LINE],
    totals: {
      taxable: '8640.00',
      tax: '1555.20',
      total: '10195.20',
      cgst: '777.60',
      sgst: '777.60',
    },
    measures: { L: '12.000' },
    approval: null,
    can: { decide: true, decideLines: true, fulfil: false },
    version: 1,
    history: [
      {
        kind: 'placed',
        at: '2026-10-20T05:00:00.000Z',
        by: { id: SME, name: 'Suresh Rao' },
        offline: false,
      },
    ],
  },
  '/v1/account-types': { items: [] },
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
        },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: {
          units: [
            { key: 'pack', name: noun('Pack', 'Packs'), base: true },
            { key: 'case', name: noun('Case', 'Cases'), base: false },
          ],
          measureTypes: ['L'],
        },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: [
            'order.create',
            'order.view',
            'order.decide',
            'order.line_decide',
            'account.view',
          ],
        },
      },
    }),
  );
  for (const prefix of ['orders', 'account-types', 'approvals']) {
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
  { path: '/orders', heading: 'Orders', shows: 'Beej Bhandar' },
  { path: `/orders/${ORDER}`, heading: 'Order 1187 · Beej Bhandar', shows: 'Decide each line' },
  { path: '/orders/new', heading: 'New order', shows: 'Which account' },
];

for (const { path, heading, shows } of PAGES) {
  for (const theme of ['light', 'outdoor']) {
    test(`${path} shows its data and passes axe in the ${theme} theme`, async ({ page }) => {
      await mockSignedIn(page);
      await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(shows).first()).toBeVisible();
      await expectAccessible(page);
    });
  }
}
