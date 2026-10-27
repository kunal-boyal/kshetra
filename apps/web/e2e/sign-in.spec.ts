import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
// As in staging and production, the cell's own address isn't the portal's: the portal still calls
// its own origin, which passes /v1 and /auth to the cell.
const CELL = 'https://api.example.test';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: CELL,
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
  // The home's dashboard, empty: signing in is what these check.
  await page.route('**/v1/dashboard**', (route) =>
    route.fulfill({
      json: {
        period: new Date().toISOString().slice(0, 7),
        view: 'self',
        people: 1,
        tiles: [],
        trend: [],
        mix: [],
        leaderboard: null,
        onDuty: null,
        onDutyPeople: null,
        onLeaveToday: null,
        waiting: { reviews: null, approvals: null, plans: null, leave: null, expenses: null },
      },
    }),
  );
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
          journeyPlanApproval: false,
          targetUnlockByAdmin: false,
          ordersNeedOpenShift: true,
          ordersAllowedOffline: true,
          planNotificationTime: '08:00',
          quietHoursStart: '21:00',
          quietHoursEnd: '07:00',
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
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== ORIGIN && /^\/(v1|auth)\//.test(url.pathname)) elsewhere.push(request.url());
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel('Mobile number').fill('90000 00001');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Anita$/ }),
  ).toBeVisible();
  await expect(page.getByText(/ · your own figures · updated /)).toBeVisible();
  await expectAccessible(page);

  // Signing out forgets what belonged to the person, so the next one on this computer sees none of it.
  await page.getByRole('button', { name: 'Your profile and settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tenants'))).toBeNull();
  expect(elsewhere).toEqual([]);
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
  await page.getByRole('button', { name: /Switch to हिन्दी/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('heading', { name: 'साइन इन करें' })).toBeVisible();
  await expect(page.getByLabel('मोबाइल नंबर')).toBeVisible();
  await expectAccessible(page);
});

test('sets up an authenticator for an admin, shows the recovery codes once, and passes axe', async ({
  page,
}) => {
  await mockApi(page);
  // An admin's code leads to the authenticator, set up the first time (decision D91).
  await page.route('**/auth/v1/otp/verify', (route) =>
    route.fulfill({
      json: {
        status: 'second_factor',
        ticket: 's'.repeat(43),
        enrolled: false,
        tenant: { id: TENANT.id, name: TENANT.name },
      },
    }),
  );
  await page.route('**/auth/v1/totp/setup', (route) =>
    route.fulfill({
      json: {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/The%20Lamp:%2B91%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A200001?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=The%20Lamp',
      },
    }),
  );
  await page.route('**/auth/v1/totp/verify', (route) =>
    route.fulfill({
      json: {
        status: 'signed_in',
        tenant: TENANT,
        session: {
          tokenType: 'Bearer',
          accessToken: 'access-token',
          accessTokenExpiresAt: later(),
          refreshTokenExpiresAt: later(),
        },
        recoveryCodes: ['K7Q2M-XW4PA', 'ZZ2AB-CD3EF', 'QQ4RS-TU5VW', 'AB2CD-EF3GH'],
      },
    }),
  );
  await page.goto('/sign-in');
  await page.getByLabel('Mobile number').fill('90000 00001');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'I have saved them' }).click();
  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Anita$/ }),
  ).toBeVisible();
});

test('finds the organisation for single sign-on from a work email, and passes axe', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/auth/v1/sso/discover', (route) =>
    route.fulfill({ json: { url: `${ORIGIN}/sso-start` } }),
  );
  await page.route('**/sso-start', (route) => route.fulfill({ body: 'Identity provider' }));
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Company SSO' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with your organisation' })).toBeVisible();
  await page.getByLabel('Work email').fill('anita@sunrise.example');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/sso-start`);
});

for (const theme of ['light', 'outdoor'] as const) {
  test(`says why single sign-on came back, accessibly, in the ${theme} theme`, async ({ page }) => {
    await mockApi(page);
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    await page.goto('/sign-in?sso=refused');
    await expect(
      page.getByText('Your organisation’s sign-in didn’t complete.', { exact: false }),
    ).toBeVisible();
    await expectAccessible(page);
  });
}
