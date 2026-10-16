import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Targets (M8) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const ADMIN = '01a10000-0000-7000-8000-000000000002';
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const SURESH = '01a10000-0000-7000-8000-000000000005';
const MONTH = new Date().toISOString().slice(0, 7);
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

function set(id: string, name: string, status: string, values: Record<string, string>) {
  return {
    user: { id, code: `SUN-${id.slice(-3)}`, name },
    period: MONTH,
    status,
    values,
    lockedAt: status === 'locked' ? '2026-10-02T07:00:00.000Z' : null,
    lockedBy: status === 'locked' ? { id: ADMIN, name: 'Asha Mehta' } : null,
    version: status === 'none' ? 0 : 1,
  };
}

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/targets': {
    period: MONTH,
    metrics: [
      {
        key: 'visits',
        name: noun('Visit', 'Visits'),
        unit: 'count',
        direction: 'higher_is_better',
        targetable: true,
      },
      {
        key: 'sales',
        name: noun('Sale', 'Sales'),
        unit: 'currency',
        direction: 'higher_is_better',
        targetable: true,
      },
    ],
    sets: [
      set(RAHUL, 'Rahul Verma', 'draft', { visits: '40', sales: '150000.00' }),
      set(SURESH, 'Suresh Rao', 'locked', { visits: '30' }),
    ],
    own: set(ADMIN, 'Asha Mehta', 'none', {}),
    totals: { visits: '70', sales: '150000.00' },
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
          permissions: ['target.view', 'target.edit', 'target.lock', 'target.unlock'],
        },
      },
    }),
  );
  for (const prefix of ['targets']) {
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

test('/targets shows the month by person, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/targets');
  await expect(page.getByRole('heading', { level: 1, name: 'Targets' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Visit for Rahul Verma' })).toHaveValue('40');
  await expect(page.getByRole('row', { name: /Team total/ })).toContainText('70');
  await expectAccessible(page);
});

test('/targets passes axe in the outdoor theme, while locking and unlocking', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/targets');
  await page.getByRole('checkbox', { name: 'Select Rahul Verma' }).check();
  await page.getByRole('button', { name: 'Lock 1 person' }).click();
  await expect(page.getByText('Lock the targets of 1 person?')).toBeVisible();
  await page
    .getByRole('row', { name: /Suresh Rao/ })
    .getByRole('button', { name: 'Unlock' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Unlock the targets of Suresh Rao' }),
  ).toBeVisible();
  await expectAccessible(page);
});
