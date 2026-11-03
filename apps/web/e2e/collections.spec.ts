import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Collections (M11, BR-63, D132) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const SHOP = '01a10000-0000-7000-8000-000000000080';
const SME = '01a10000-0000-7000-8000-000000000004';
const CASH = '01a10000-0000-7000-8000-0000000000d1';
const CHEQUE = '01a10000-0000-7000-8000-0000000000d3';
const later = () => new Date(Date.now() + 3_600_000).toISOString();

function collection(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    number: 'COL-000001',
    account: { id: SHOP, code: 'D-81', name: 'Beej Bhandar' },
    collector: { id: SME, code: 'SME-04', name: 'Suresh Rao' },
    collectedOn: '2026-11-02',
    collectedAt: '2026-11-02T06:30:00.000Z',
    amount: '12000.00',
    mode: 'cash',
    reference: null,
    chequeNumber: null,
    chequeBank: null,
    chequeDate: null,
    note: null,
    photos: [],
    inGeofence: true,
    status: 'recorded',
    reason: null,
    decidedBy: null,
    decidedAt: null,
    receipt: null,
    can: { decide: true, bounce: false, match: false, unmatch: false },
    ...overrides,
  };
}

const ANSWERS: Record<string, unknown> = {
  '/v1/collections': {
    items: [
      collection(CASH),
      collection(CHEQUE, {
        number: 'COL-000002',
        mode: 'cheque',
        chequeNumber: '004512',
        chequeBank: 'Bank of Maharashtra',
        chequeDate: '2026-11-05',
        amount: '5000.50',
      }),
    ],
    nextCursor: null,
    summary: {
      counts: { recorded: 2, in_books: 1 },
      amounts: { recorded: '17000.50', in_books: '7000.00' },
    },
  },
  [`/v1/collections/${CASH}`]: collection(CASH),
  [`/v1/collections/${CHEQUE}`]: collection(CHEQUE, {
    number: 'COL-000002',
    mode: 'cheque',
    chequeNumber: '004512',
    chequeBank: 'Bank of Maharashtra',
    chequeDate: '2026-11-05',
    amount: '5000.50',
  }),
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
        catalogue: { units: [], measureTypes: [], itemFields: [], rounding: 'per_unit_first' },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['account.view', 'collection.view', 'collection.confirm'],
        },
      },
    }),
  );
  await page.route('**/v1/collections**', (route) => {
    const answer = ANSWERS[new URL(route.request().url()).pathname];
    return answer
      ? route.fulfill({ json: answer })
      : route.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'r' } },
        });
  });
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
  { path: '/collections', heading: 'Collections', shows: 'Cheque 004512 · Bank of Maharashtra' },
  { path: `/collections/${CASH}`, heading: 'COL-000001', shows: 'Payment received' },
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
