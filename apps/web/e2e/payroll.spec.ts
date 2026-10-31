import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Payroll inputs (M14, D117) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 3_600_000).toISOString();
const ASHA = '01a10000-0000-7000-8000-000000000004';
const PERIOD = '2026-09';

const month = (patch: object) => ({
  user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao', designation: 'executive' },
  period: PERIOD,
  monthlyGross: '30000.00',
  scheduled: 26,
  paid: 23.5,
  amount: '27115.38',
  toDate: false,
  ...patch,
});

const ANSWERS: Record<string, unknown> = {
  '/v1/payroll': {
    items: [
      month({}),
      month({
        user: {
          id: '01a10000-0000-7000-8000-000000000005',
          code: 'SUN-005',
          name: 'Ravi Kumar',
          designation: 'executive',
        },
        monthlyGross: null,
        amount: null,
      }),
    ],
    nextCursor: null,
  },
  [`/v1/payslips/${ASHA}/${PERIOD}`]: {
    ...month({}),
    days: {
      future: 0,
      not_employed: 0,
      present: 22,
      half_day: 1,
      paid_leave: 1,
      unpaid_leave: 0,
      holiday: 1,
      weekly_off: 4,
      absent: 1,
    },
  },
  '/v1/organisation': { name: 'Sunrise Traders', logo: null },
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
          permissions: ['payroll.manage', 'report.view'],
        },
      },
    }),
  );
  for (const prefix of ['payroll', 'payslips', 'organisation']) {
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
  test(`/payroll shows the month's estimates and passes axe in the ${theme} theme`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { level: 1, name: /^Payroll · / })).toBeVisible();
    await expect(page.getByText('No gross yet')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Set gross: Ravi Kumar' }).click();
    await expect(page.getByRole('form', { name: 'Monthly gross for Ravi Kumar' })).toBeVisible();
    await expectAccessible(page);
  });
}

test('a payslip preview passes axe and prints alone, as an estimate (D99)', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    window.print = () => {
      const sheet = document.querySelector<HTMLElement>('body > .ks-print-sheet');
      (window as unknown as { printed: unknown }).printed = {
        sheet: sheet ? getComputedStyle(sheet).display !== 'none' : false,
        text: sheet?.textContent ?? '',
      };
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.goto(`/payroll/${ASHA}/${PERIOD}`);
  await expect(page.getByText('Provisional pay: ₹27,115.38')).toBeVisible();
  await expectAccessible(page);
  await page.emulateMedia({ media: 'print' });
  await page.getByRole('button', { name: 'Print' }).click();
  const printed = await page.evaluate(() => (window as unknown as { printed: unknown }).printed);
  await page.emulateMedia({ media: 'screen' });
  expect(printed).toEqual({
    sheet: true,
    text: expect.stringContaining('Attendance-based estimate. This is not a statutory payroll'),
  });
});
