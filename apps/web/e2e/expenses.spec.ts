import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Expenses (M12, D83) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 3_600_000).toISOString();
const named = (en: string) => ({ en, hi: en });

const claim = (id: string, patch: object) => ({
  id,
  userId: '01a10000-0000-7000-8000-000000000004',
  user: { id: '01a10000-0000-7000-8000-000000000004', code: 'SUN-004', name: 'Rahul Verma' },
  policy: 'meals',
  policyVersion: 1,
  expenseDate: '2026-10-05',
  description: 'Team lunch',
  quantity: null,
  rate: null,
  odometerOpen: null,
  odometerClose: null,
  trackedKm: null,
  shiftId: null,
  billAmount: '412.50',
  calculated: '412.50',
  amount: '412.50',
  capped: false,
  receipts: ['01a10000-0000-7000-8000-0000000000f1'],
  odometerPhotos: [],
  flags: ['duplicate_receipt'],
  state: 'approved',
  approval: null,
  paidAt: null,
  paymentReference: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  decidedAt: '2026-10-06T09:00:00.000Z',
  ...patch,
});

const ANSWERS: Record<string, unknown> = {
  '/v1/expense-policies': {
    items: [
      {
        key: 'meals',
        name: named('Meals'),
        category: 'other',
        calculation: 'actual',
        caps: {},
        receiptRequired: true,
        odometerPhotosRequired: false,
        active: true,
        version: 1,
        validFrom: '2000-01-01',
      },
      {
        key: 'travel',
        name: named('Travel'),
        category: 'travel',
        calculation: 'per_km',
        kmFrom: 'tracked',
        rate: { flat: '5' },
        caps: {},
        receiptRequired: false,
        odometerPhotosRequired: false,
        active: true,
        version: 1,
        validFrom: '2000-01-01',
      },
    ],
  },
  '/v1/expense-claims': {
    items: [
      claim('01a10000-0000-7000-8000-0000000000e1', {}),
      claim('01a10000-0000-7000-8000-0000000000e2', {
        description: 'Tour',
        calculated: '1500.00',
        amount: '1200.00',
        capped: true,
        flags: ['capped'],
        state: 'pending',
      }),
      // A per-km claim whose readings and tracked distance disagree (decision D115).
      claim('01a10000-0000-7000-8000-0000000000e3', {
        policy: 'travel',
        description: 'Route and back',
        quantity: '30.400',
        rate: '5.00',
        odometerOpen: '1000.0',
        odometerClose: '1042.0',
        trackedKm: '30.40',
        billAmount: null,
        calculated: '152.00',
        amount: '152.00',
        receipts: [],
        flags: ['distance_gap'],
        state: 'pending',
      }),
    ],
    nextCursor: null,
    summary: {
      claimed: '1612.50',
      claims: 2,
      waiting: '1200.00',
      waitingClaims: 1,
      overPolicy: '300.00',
      approved: '412.50',
      approvedClaims: 1,
    },
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
        },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['expense.mark_paid', 'approval.act'],
        },
      },
    }),
  );
  for (const prefix of ['expense-policies', 'expense-claims']) {
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

for (const theme of ['light', 'outdoor']) {
  test(`/expenses shows its claims and passes axe in the ${theme} theme`, async ({ page }) => {
    await mockSignedIn(page);
    await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
    await page.goto('/expenses');
    await expect(page.getByRole('heading', { level: 1, name: /^Expenses · / })).toBeVisible();
    await expect(page.getByText('Receipt seen before')).toBeVisible();
    await expect(page.getByText('42 km on the odometer · 30.4 km tracked')).toBeVisible();
    await expect(page.getByText('Tracked and odometer km differ')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: /Mark paid: Rahul Verma/ }).click();
    await expect(
      page.getByRole('group', { name: /Mark ₹412.50 to Rahul Verma paid/ }),
    ).toBeVisible();
    await expectAccessible(page);
  });
}
