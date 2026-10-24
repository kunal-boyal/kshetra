import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

const ADMIN = {
  id: '01a10000-0000-7000-8000-0000000000a1',
  email: 'meera@vendor.example',
  name: 'Meera Iyer',
  role: 'platform_admin',
  status: 'active',
  permissions: [
    'platform.tenant.manage',
    'platform.plan.manage',
    'platform.support.request',
    'platform.support.approve_emergency',
    'platform.flags.manage',
    'platform.billing.manage',
    'platform.staff.manage',
  ],
  lastSignInAt: '2026-10-24T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
};
const TENANT = {
  id: '01a10000-0000-7000-8000-0000000000b1',
  slug: 'sunrise-agro',
  name: 'Sunrise Agro',
  status: 'trial',
  cell: { name: 'local', region: 'ap-south-1', kind: 'shared' },
  template: { key: 'agri', version: 4 },
  trialEndsAt: '2026-11-23T10:00:00.000Z',
  demo: false,
  activeUsers: 12,
  createdAt: '2026-10-24T10:00:00.000Z',
};

/** Answers the console's calls as the API would; `signedIn` starts with a live session cookie. */
async function mockApi(page: Page, { signedIn }: { signedIn: boolean }) {
  let session = signedIn;
  await page.route('**/platform/v1/session/refresh', (route) =>
    session
      ? route.fulfill({ json: { accessToken: 'a', accessTokenExpiresAt: later(), staff: ADMIN } })
      : route.fulfill({
          status: 401,
          json: { error: { code: 'SESSION_REVOKED', message: 'Sign in.', requestId: 'r' } },
        }),
  );
  await page.route('**/platform/v1/session', (route) => {
    // The console asks for its cookie with its own client header.
    expect(route.request().headers()['x-client']).toBe('console');
    session = true;
    return route.fulfill({
      json: { accessToken: 'a', accessTokenExpiresAt: later(), staff: ADMIN },
    });
  });
  await page.route('**/platform/v1/session/logout', (route) => {
    session = false;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/platform/v1/setup', (route) =>
    route.fulfill({
      json: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' },
    }),
  );
  await page.route('**/platform/v1/setup/confirm', (route) => route.fulfill({ json: ADMIN }));
  await page.route('**/platform/v1/tenants?**', (route) =>
    route.fulfill({ json: { items: [TENANT], nextCursor: null } }),
  );
  await page.route(`**/platform/v1/tenants/${TENANT.id}`, (route) =>
    route.fulfill({ json: TENANT }),
  );
  await page.route('**/platform/v1/templates', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            key: 'agri',
            version: 4,
            name: { en: 'Agri inputs', hi: 'कृषि इनपुट' },
            description: { en: 'For seed, crop protection and fertiliser companies', hi: 'बीज' },
          },
        ],
      },
    }),
  );
  await page.route('**/platform/v1/staff', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 201,
          json: {
            staff: {
              ...ADMIN,
              id: '01a10000-0000-7000-8000-0000000000a3',
              name: 'Asha Rao',
              status: 'invited',
            },
            setupUrl: 'http://127.0.0.1:4174/setup#a-one-time-secret',
          },
        })
      : route.fulfill({ json: { items: [ADMIN] } }),
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

test('signs in with all three, signs out, and the sign-in screen passes axe', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expectAccessible(page);
  await page.getByLabel(/^Email/).fill('meera@vendor.example');
  await page.getByLabel(/^Password/).fill('a long password');
  await page.getByLabel(/^Authenticator code/).fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByText('Meera Iyer, Platform admin')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('sets up from an invitation, and both steps pass axe', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/setup#a-one-time-secret');
  await expectAccessible(page);
  await page.getByLabel(/^New password/).fill('a long password!');
  await page.getByLabel(/^The password again/).fill('a long password!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Setup key')).toHaveText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  await expectAccessible(page);
  await page.getByLabel(/^Authenticator code/).fill('123456');
  await page.getByRole('button', { name: 'Finish setting up' }).click();
  await expect(page.getByRole('heading', { name: 'You are set up' })).toBeVisible();
  await expectAccessible(page);
});

for (const [path, heading] of [
  ['/', 'Tenants'],
  ['/tenants/new', 'New tenant'],
  [`/tenants/${TENANT.id}`, 'Sunrise Agro'],
  ['/staff', 'Staff'],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${path} passes axe in the ${theme} theme`, async ({ page }) => {
      await mockApi(page, { signedIn: true });
      await page.addInitScript((chosen) => localStorage.setItem('console.theme', chosen), theme);
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
}

test('shows a new staff member’s setup link once, accessibly', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/staff');
  await page.getByLabel(/^Name/).fill('Asha Rao');
  await page.getByLabel(/^Email/).fill('asha@vendor.example');
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText('http://127.0.0.1:4174/setup#a-one-time-secret')).toBeVisible();
  await expectAccessible(page);
});
