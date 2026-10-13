import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

/** Answers the page's API calls as the directory and cell would, for a person not yet signed in. */
async function mockApi(page: Page) {
  await page.route('**/auth/v1/token/refresh', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_REVOKED', message: 'Sign in.', requestId: 'r' } },
    }),
  );
  await page.route('**/auth/v1/otp/request', (route) =>
    route.fulfill({ status: 202, json: { expiresInSeconds: 300 } }),
  );
  await page.route('**/auth/v1/otp/verify', (route) => {
    const headers = route.request().headers();
    // The web asks for the refresh token as a cookie, and never receives it in the body.
    expect(headers['x-client']).toBe('web');
    return route.fulfill({
      json: {
        status: 'signed_in',
        tenant: TENANT,
        session: {
          tokenType: 'Bearer',
          accessToken: 'access-token',
          accessTokenExpiresAt: later(),
          refreshTokenExpiresAt: later(),
        },
      },
    });
  });
  await page.route('**/auth/v1/logout', (route) => route.fulfill({ status: 204 }));
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      json: {
        userId: '01a10000-0000-7000-8000-000000000002',
        tenantId: TENANT.id,
        cell: 'local',
        code: 'SUN-001',
        name: 'Anita Rao',
        designation: 'head',
        role: 'tenant_admin',
        scope: 'tenant',
        permissions: ['user.view'],
        deviceId: null,
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
          targetUnlockByAdmin: false,
          ordersNeedOpenShift: true,
          ordersAllowedOffline: true,
        },
        terminology: {},
        designations: [
          {
            key: 'head',
            name: { en: { one: 'Head', other: 'Heads' }, hi: { one: 'प्रमुख', other: 'प्रमुख' } },
            level: 1,
            ranked: false,
          },
        ],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'tenant_admin', scope: 'tenant', permissions: ['user.view'] },
      },
    }),
  );
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

test('signs in with a number and a code, signs out, and every screen passes axe', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel('Mobile number').fill('90000 00001');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Hello, Anita Rao' })).toBeVisible();
  await expect(page.getByText('Head at Sunrise Traders')).toBeVisible();
  await expectAccessible(page);

  // Signing out forgets what belonged to the person, so the next one on this computer sees none of it.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tenants'))).toBeNull();
});

for (const theme of ['dark', 'outdoor'] as const) {
  test(`the sign-in screen passes axe in the ${theme} theme`, async ({ page }) => {
    await mockApi(page);
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}

test('speaks Hindi when chosen, with the extra line height Devanagari needs', async ({ page }) => {
  await mockApi(page);
  await page.goto('/sign-in');
  await page.getByRole('combobox').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('heading', { name: 'साइन इन करें' })).toBeVisible();
  await expect(page.getByLabel('मोबाइल नंबर')).toBeVisible();
  await expectAccessible(page);
});
