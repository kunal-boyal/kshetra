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
  plan: null,
  trialEndsAt: '2026-11-23T10:00:00.000Z',
  demo: false,
  activeUsers: 12,
  terminatedAt: null,
  deletesAt: null,
  deletedAt: null,
  createdAt: '2026-10-24T10:00:00.000Z',
};

const PLAN = {
  id: '01a10000-0000-7000-8000-0000000000c1',
  key: 'growth',
  name: { en: 'Growth', hi: 'ग्रोथ' },
  priceMonth: '499.00',
  priceYear: '4990.00',
  modules: ['core', 'leave_attendance', 'orders'],
  limits: {
    users: 25,
    storageGb: 50,
    apiPerMinute: 300,
    requestsPerMinute: 10_000,
    queueSlots: 2,
    importRows: null,
    exportRows: null,
  },
  addons: [{ key: 'sms_pack', name: { en: 'SMS pack', hi: 'SMS पैक' }, price: '250.00' }],
  active: true,
  tenants: 1,
  createdAt: '2026-10-20T10:00:00.000Z',
};

const INVOICE = {
  id: '01a10000-0000-7000-8000-0000000000e1',
  number: 'TL/26-27/00042',
  tenant: { id: TENANT.id, name: TENANT.name, slug: TENANT.slug },
  kind: 'monthly',
  period: { from: '2026-10-01', to: '2026-10-31' },
  issuedOn: '2026-11-04',
  dueOn: '2099-11-19',
  seller: {
    legalName: 'Example Field Software Private Limited',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Unit 4, Example Business Park, Pune 411045',
    stateCode: '27',
    stateName: 'Maharashtra',
    email: 'billing@vendor.example',
    sac: '998314',
  },
  buyer: {
    legalName: 'Sunrise Agro Private Limited',
    gstin: null,
    address: 'Plot 9, MIDC, Nashik 422010',
    stateCode: '27',
    stateName: 'Maharashtra',
  },
  lines: [
    {
      description: 'Seats on the Growth plan, October 2026 (per seat per month, prorated by day)',
      quantity: '11.4839',
      rate: '499.00',
      amount: '5730.47',
    },
  ],
  subtotal: '5730.47',
  gstRate: '18',
  cgst: '515.74',
  sgst: '515.74',
  igst: '0.00',
  total: '6761.95',
  paid: '1000.00',
  status: 'issued',
  example: true,
  payments: [
    {
      id: '01a10000-0000-7000-8000-0000000000f1',
      amount: '1000.00',
      method: 'upi',
      reference: 'UTR 4471',
      receivedOn: '2026-11-05',
      recordedAt: '2026-11-05T10:00:00.000Z',
    },
  ],
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
  await page.route(`**/platform/v1/tenants/${TENANT.id}/entitlements`, (route) =>
    route.fulfill({
      json: {
        plan: { id: PLAN.id, key: PLAN.key, name: PLAN.name },
        extraModules: ['expenses'],
        modules: ['core', 'leave_attendance', 'orders', 'expenses'],
        limits: {
          users: 25,
          storageGb: 50,
          apiPerMinute: 300,
          requestsPerMinute: 10_000,
          queueSlots: 2,
          importRows: null,
          exportRows: null,
        },
        ownLimits: {},
      },
    }),
  );
  await page.route(`**/platform/v1/tenants/${TENANT.id}/usage?**`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            period: '2026-10',
            metrics: {
              seats: '11.4839',
              active_users: '9.0000',
              storage_bytes: '2684354560.0000',
              sms: '42.0000',
              whatsapp: '0.0000',
              api_calls: '18250.0000',
            },
            updatedAt: '2026-10-25T10:00:00.000Z',
          },
        ],
      },
    }),
  );
  await page.route('**/platform/v1/plans', (route) => route.fulfill({ json: { items: [PLAN] } }));
  await page.route('**/platform/v1/billing/settings', (route) =>
    route.fulfill({
      json: {
        seller: INVOICE.seller,
        invoicePrefix: 'EX',
        gstRate: '18',
        paymentTermsDays: 15,
        graceDays: 7,
        readOnlyDays: 14,
        example: true,
        ready: true,
      },
    }),
  );
  await page.route(`**/platform/v1/tenants/${TENANT.id}/billing`, (route) =>
    route.fulfill({
      json: {
        account: {
          legalName: 'Sunrise Agro Private Limited',
          gstin: null,
          address: 'Plot 9, MIDC, Nashik 422010',
          stateCode: '27',
          email: 'accounts@sunrise.example',
          language: 'en',
          mandate: 'failed',
        },
        subscription: {
          id: '01a10000-0000-7000-8000-0000000000d1',
          plan: { id: PLAN.id, key: PLAN.key, name: PLAN.name },
          cycle: 'month',
          committedSeats: null,
          status: 'active',
          startedOn: '2026-10-01',
          term: null,
          endsOn: null,
        },
        outstanding: '5761.95',
        dunning: {
          overdueSince: '2026-11-04',
          stage: 'grace',
          readOnlyOn: '2026-11-11',
          suspendOn: '2026-11-25',
          outstanding: '5761.95',
        },
      },
    }),
  );
  await page.route('**/platform/v1/invoices?**', (route) =>
    route.fulfill({ json: { items: [INVOICE], nextCursor: null } }),
  );
  await page.route(`**/platform/v1/invoices/${INVOICE.id}`, (route) =>
    route.fulfill({ json: INVOICE }),
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
  await page.route('**/platform/v1/health', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            cell: { name: 'local', region: 'ap-south-1', kind: 'shared' },
            latest: {
              at: '2026-10-26T10:00:00.000Z',
              figures: {
                requests: 412,
                errors: 13,
                points: 960,
                latePoints: 40,
                queues: {
                  notifications: {
                    waiting: 3,
                    active: 1,
                    delayed: 0,
                    failed: 0,
                    oldestWaitSeconds: 12,
                  },
                  exports: {
                    waiting: 40,
                    active: 1,
                    delayed: 0,
                    failed: 2,
                    oldestWaitSeconds: 420,
                  },
                },
                outbox: { backlog: 0, oldestSeconds: null },
                phones: { seen: 120, waiting: 8, parked: 1, oldestQueuedSeconds: 7500 },
              },
            },
            issues: [{ key: 'errors' }, { key: 'queue', queue: 'exports' }],
            hours: [
              {
                hour: '2026-10-26T10:00:00.000Z',
                requests: 412,
                errors: 13,
                points: 960,
                latePoints: 40,
                worstQueueWaitSeconds: 420,
                worstSyncSeconds: 7500,
                minutes: 1,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route('**/platform/v1/announcements', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '01a10000-0000-7000-8000-0000000000d1',
            title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
            body: { en: 'Down from 11 pm to midnight.', hi: 'रात 11 से 12 बजे तक बंद।' },
            tone: 'warning',
            surfaces: ['web', 'mobile'],
            tenants: null,
            startsAt: '2026-10-26T04:00:00.000Z',
            endsAt: '2099-10-27T04:00:00.000Z',
            status: 'showing',
            createdBy: 'Meera Iyer',
            createdAt: '2026-10-26T03:50:00.000Z',
            withdrawnAt: null,
          },
        ],
      },
    }),
  );
  await page.route('**/platform/v1/support-grants?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '01a10000-0000-7000-8000-0000000000f1',
            tenant: { id: TENANT.id, name: TENANT.name },
            staff: { id: ADMIN.id, name: ADMIN.name },
            reason: 'Checking why the visit report is empty',
            scope: 'read',
            hours: 4,
            emergency: false,
            status: 'active',
            grantedScope: 'read',
            approvedBy: { kind: 'user', name: 'Anita Rao' },
            startsAt: '2026-10-26T04:00:00.000Z',
            endsAt: '2099-10-26T08:00:00.000Z',
            closedAt: null,
            closedBy: null,
            createdAt: '2026-10-26T03:50:00.000Z',
          },
          {
            id: '01a10000-0000-7000-8000-0000000000f2',
            tenant: { id: TENANT.id, name: TENANT.name },
            staff: { id: '01a10000-0000-7000-8000-0000000000a2', name: 'Ravi Shah' },
            reason: 'Orders are failing for everyone',
            scope: 'read',
            hours: 2,
            emergency: true,
            status: 'requested',
            grantedScope: null,
            approvedBy: null,
            startsAt: null,
            endsAt: null,
            closedAt: null,
            closedBy: null,
            createdAt: '2026-10-26T03:55:00.000Z',
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
  ['/plans', 'Plans'],
  ['/plans/new', 'New plan'],
  [`/plans/${PLAN.id}`, 'Growth'],
  ['/billing', 'Billing'],
  ['/billing/settings', 'Billing settings'],
  [`/invoices/${INVOICE.id}`, 'Invoice TL/26-27/00042'],
  ['/staff', 'Staff'],
  ['/account', 'Your account'],
  ['/support', 'Support access'],
  ['/announcements', 'Announcements'],
  ['/health', 'Health'],
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

test('changing a tenant’s plan passes axe, with its usage beside it', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/tenants/${TENANT.id}`);
  await expect(page.getByText('12 of 25 active')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Usage' })).toContainText('2.5 GB');
  await page.getByRole('button', { name: 'Change the plan' }).click();
  await page.getByLabel('People active at once').selectOption('own');
  await expect(page.getByLabel(/^People/).last()).toBeVisible();
  await expectAccessible(page);
});

test('terminating a suspended tenant asks for its slug, accessibly', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.route(`**/platform/v1/tenants/${TENANT.id}`, (route) =>
    route.fulfill({ json: { ...TENANT, status: 'suspended' } }),
  );
  await page.goto(`/tenants/${TENANT.id}`);
  const card = page.getByRole('region', { name: 'Termination' });
  await card.getByRole('button', { name: 'Terminate' }).click();
  await expect(card.getByLabel('Type sunrise-agro to confirm')).toBeVisible();
  await expectAccessible(page);
});

test('a terminated tenant’s exports for the customer pass axe', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.route(`**/platform/v1/tenants/${TENANT.id}`, (route) =>
    route.fulfill({
      json: {
        ...TENANT,
        status: 'terminated',
        terminatedAt: '2026-10-26T05:00:00.000Z',
        deletesAt: '2026-11-25T05:00:00.000Z',
      },
    }),
  );
  await page.route(`**/platform/v1/tenants/${TENANT.id}/data-exports`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '01a10000-0000-7000-8000-0000000000f5',
            status: 'ready',
            requestedBy: { id: null, name: 'Ravi Shah' },
            fileName: 'data-export-2026-10-26.zip',
            bytes: 52428800,
            sha256: '9f2c4e1a7b3d5f6e8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f',
            tables: 84,
            rows: 120431,
            files: 312,
            keyId: '0123456789abcdef',
            error: null,
            createdAt: '2026-10-26T05:00:00.000Z',
            finishedAt: '2026-10-26T05:04:00.000Z',
            expiresAt: '2099-11-02T05:04:00.000Z',
            download: null,
          },
        ],
      },
    }),
  );
  await page.goto(`/tenants/${TENANT.id}`);
  const card = page.getByRole('region', { name: 'Termination' });
  await expect(card.getByText(/Its data is deleted on 25 Nov 2026/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Copy a download link' })).toBeVisible();
  await expectAccessible(page);
});

test('a tenant’s billing, cancelling its subscription, passes axe', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/tenants/${TENANT.id}`);
  await expect(page.getByText(/Overdue since 4 Nov 2026: in grace/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Invoices' })).toContainText('TL/26-27/00042');
  await page.getByRole('button', { name: 'Cancel the subscription' }).click();
  await expect(
    page.getByRole('group', { name: /Cancel Sunrise Agro’s subscription/ }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('runs under its Content-Security-Policy, which nothing on the page breaks (D101)', async ({
  page,
}) => {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (line: string) => violations.push(line));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { reportViolation: (line: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      ),
    ),
  );
  await mockApi(page, { signedIn: true });
  const reply = await page.goto('/billing');
  expect(reply?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  expect(violations).toEqual([]);
});
