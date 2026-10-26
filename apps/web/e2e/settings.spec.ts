import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Tenant administration (M2) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

/** What the cell answers to a GET, by path. */
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const TYPE_ID = '01a10000-0000-7000-8000-000000000301';
const ITEM_ID = '01a10000-0000-7000-8000-0000000000b0';
const LIST_ID = '01a10000-0000-7000-8000-0000000000c0';
const unitName = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const UNITS = [
  { key: 'pack', name: unitName('Pack', 'Packs'), base: true },
  { key: 'case', name: unitName('Case', 'Cases'), base: false },
];
const ITEM = {
  id: ITEM_ID,
  code: 'NEEM-500',
  name: 'Neem Shield 500 ML',
  product: { id: '01a10000-0000-7000-8000-0000000000b1', name: 'Neem Shield' },
  category: null,
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
};
const LIST = {
  id: LIST_ID,
  name: 'Standard',
  scope: 'default',
  targets: [],
  priority: 0,
  validFrom: '2026-04-01',
  validTo: null,
  active: true,
  version: 2,
  itemCount: 1,
  updatedAt: '2026-10-20T05:00:00.000Z',
};

const SUPPORT_BASE = {
  tenant: { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders' },
  staff: { id: '01a10000-0000-7000-8000-0000000000a2', name: 'Ravi Shah' },
  emergency: false,
  closedAt: null,
  closedBy: null,
  createdAt: '2026-10-26T03:50:00.000Z',
};

const ANSWERS: Record<string, unknown> = {
  '/v1/support-grants': {
    items: [
      {
        ...SUPPORT_BASE,
        id: '01a10000-0000-7000-8000-0000000000f1',
        reason: 'Setting up designations with you',
        scope: 'write',
        hours: 4,
        status: 'requested',
        grantedScope: null,
        approvedBy: null,
        startsAt: null,
        endsAt: null,
      },
      {
        ...SUPPORT_BASE,
        id: '01a10000-0000-7000-8000-0000000000f2',
        reason: 'Checking why the visit report is empty',
        scope: 'read',
        hours: 2,
        status: 'active',
        grantedScope: 'read',
        approvedBy: { kind: 'user', name: 'Anita Rao' },
        startsAt: '2026-10-26T04:00:00.000Z',
        endsAt: '2099-10-26T06:00:00.000Z',
      },
      {
        ...SUPPORT_BASE,
        id: '01a10000-0000-7000-8000-0000000000f3',
        reason: 'Looking at a failed import',
        scope: 'read',
        hours: 1,
        status: 'ended',
        grantedScope: 'read',
        approvedBy: { kind: 'user', name: 'Anita Rao' },
        startsAt: '2026-10-20T04:00:00.000Z',
        endsAt: '2026-10-20T05:00:00.000Z',
        closedAt: '2026-10-20T04:30:00.000Z',
        closedBy: { kind: 'staff', name: 'Ravi Shah' },
      },
    ],
  },
  '/v1/audit': { items: [], nextCursor: null },
  // Announcements show above every settings page, so axe checks them in each theme.
  '/v1/announcements': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000d1',
        title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
        body: { en: 'Down from 11 pm to midnight.', hi: 'रात 11 से 12 बजे तक बंद।' },
        tone: 'warning',
        endsAt: '2099-10-27T04:00:00.000Z',
      },
      {
        id: '01a10000-0000-7000-8000-0000000000d2',
        title: { en: 'New reports', hi: 'नई रिपोर्टें' },
        body: { en: 'Visit reports are faster.', hi: 'विज़िट रिपोर्टें तेज़ हैं।' },
        tone: 'info',
        endsAt: '2099-10-27T04:00:00.000Z',
      },
    ],
  },
  '/v1/api-clients': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        name: 'Tally ERP',
        clientId: '01a1000000007000800000000000000.k3j9x2',
        scopes: ['people:read', 'accounts:write', 'metrics:write'],
        status: 'active',
        createdAt: '2026-10-20T05:00:00.000Z',
        lastUsedAt: '2026-10-26T04:10:00.000Z',
        revokedAt: null,
      },
      {
        id: '01a10000-0000-7000-8000-0000000000e2',
        name: 'Old HR sync',
        clientId: '01a1000000007000800000000000000.p8w4q1',
        scopes: ['people:write'],
        status: 'revoked',
        createdAt: '2026-09-01T05:00:00.000Z',
        lastUsedAt: null,
        revokedAt: '2026-10-01T05:00:00.000Z',
      },
    ],
  },
  '/v1/webhooks': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e5',
        url: 'https://erp.sunrise.example/hooks',
        events: ['account.created', 'order.placed'],
        description: 'Tally ERP',
        status: 'active',
        createdAt: '2026-10-20T05:00:00.000Z',
        lastDelivery: { status: 'failed', responseCode: 503, at: '2026-10-26T04:12:00.000Z' },
      },
      {
        id: '01a10000-0000-7000-8000-0000000000e6',
        url: 'https://hr.sunrise.example/events',
        events: ['user.created'],
        description: null,
        status: 'paused',
        createdAt: '2026-10-21T05:00:00.000Z',
        lastDelivery: null,
      },
    ],
  },
  '/v1/webhooks/01a10000-0000-7000-8000-0000000000e5/deliveries': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e7',
        messageId: '01a10000-0000-7000-8000-0000000000e8',
        event: 'order.placed',
        eventId: '01a10000-0000-7000-8000-0000000000e9',
        attempt: 3,
        status: 'failed',
        responseCode: 503,
        durationMs: 120,
        error: null,
        messageStatus: 'failed',
        createdAt: '2026-10-26T04:12:00.000Z',
      },
      {
        id: '01a10000-0000-7000-8000-0000000000ea',
        messageId: '01a10000-0000-7000-8000-0000000000eb',
        event: 'account.created',
        eventId: '01a10000-0000-7000-8000-0000000000ec',
        attempt: 1,
        status: 'delivered',
        responseCode: 200,
        durationMs: 85,
        error: null,
        messageStatus: 'delivered',
        createdAt: '2026-10-26T03:00:00.000Z',
      },
    ],
    nextCursor: null,
  },
  '/v1/sso': {
    connection: {
      protocol: 'saml',
      issuer: null,
      clientId: null,
      hasClientSecret: false,
      entryPoint: 'https://idp.sunrise.example/sso',
      idpIssuer: 'https://idp.sunrise.example',
      hasIdpCertificate: true,
      domains: ['sunrise.example'],
      enabled: true,
      enforced: false,
      updatedAt: '2026-10-25T06:00:00.000Z',
    },
    provider: {
      redirectUri: 'http://127.0.0.1:4173/auth/v1/sso/sunrise/oidc/callback',
      entityId: 'http://127.0.0.1:4173/auth/v1/sso/sunrise/saml/metadata',
      acsUrl: 'http://127.0.0.1:4173/auth/v1/sso/sunrise/saml/acs',
      metadataUrl: 'http://127.0.0.1:4173/auth/v1/sso/sunrise/saml/metadata',
    },
  },
  '/v1/billing': {
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
      plan: {
        id: '01a10000-0000-7000-8000-0000000000c1',
        key: 'growth',
        name: { en: 'Growth', hi: 'ग्रोथ' },
      },
      cycle: 'year',
      committedSeats: 20,
      status: 'active',
      startedOn: '2026-10-01',
      term: { from: '2026-10-01', to: '2027-09-30' },
      endsOn: null,
    },
    outstanding: '6761.95',
    dunning: {
      overdueSince: '2026-11-20',
      stage: 'read_only',
      readOnlyOn: '2026-11-27',
      suspendOn: '2026-12-11',
      outstanding: '6761.95',
    },
    plan: { name: { en: 'Growth', hi: 'ग्रोथ' }, priceMonth: '499.00', priceYear: '4990.00' },
    modules: ['core', 'orders'],
    people: { active: 12, limit: 25 },
    trialEndsAt: null,
    automaticPayment: true,
    usage: [
      {
        period: '2026-10',
        metrics: { seats: '11.4839', sms: '42.0000', storage_bytes: '2684354560.0000' },
        updatedAt: '2026-10-31T18:00:00.000Z',
      },
    ],
  },
  '/v1/billing/invoices': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        number: 'TL/26-27/00042',
        tenant: { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise', slug: 'sunrise' },
        kind: 'annual',
        period: { from: '2026-10-01', to: '2027-09-30' },
        issuedOn: '2026-10-01',
        dueOn: '2026-10-16',
        seller: {
          legalName: 'Example Field Software Private Limited',
          gstin: '27ZZZZZ0000Z1ZQ',
          address: 'Pune',
          stateCode: '27',
          stateName: 'Maharashtra',
          email: 'billing@vendor.example',
          sac: '998314',
        },
        buyer: {
          legalName: 'Sunrise Agro Private Limited',
          gstin: null,
          address: 'Nashik',
          stateCode: '27',
          stateName: 'Maharashtra',
        },
        lines: [],
        subtotal: '99800.00',
        gstRate: '18',
        cgst: '8982.00',
        sgst: '8982.00',
        igst: '0.00',
        total: '117764.00',
        paid: '0.00',
        status: 'issued',
        example: false,
        payments: [],
      },
    ],
    nextCursor: null,
  },
  '/v1/catalogue': { version: 2, units: UNITS, measureTypes: ['kg', 'L'], items: [ITEM] },
  '/v1/price-lists': { items: [LIST] },
  [`/v1/price-lists/${LIST_ID}`]: LIST,
  [`/v1/price-lists/${LIST_ID}/items`]: {
    items: [
      {
        item: {
          id: ITEM_ID,
          code: 'NEEM-500',
          name: 'Neem Shield 500 ML',
          packLabel: '500 ML',
          baseUnit: 'pack',
          taxRate: '18.0000',
        },
        price: '400.00',
        discount: '10.0000',
        rate: '360.00',
      },
    ],
    nextCursor: null,
  },
  '/v1/organisation': { name: 'Sunrise Traders', logo: null },
  '/v1/expense-policies': {
    items: [
      {
        key: 'fuel',
        name: { en: 'Fuel', hi: 'ईंधन' },
        category: 'travel',
        calculation: 'per_km',
        rate: { flat: '3.50' },
        caps: { perDay: '500' },
        receiptRequired: false,
        odometerPhotosRequired: true,
        active: true,
        version: 2,
        validFrom: '2026-10-01',
      },
    ],
  },
  '/v1/leave-types': {
    items: [
      {
        key: 'casual',
        name: { en: 'Casual leave', hi: 'आकस्मिक अवकाश' },
        paid: true,
        annualQuota: 12,
        quotaYear: 'calendar',
        halfDayAllowed: true,
        active: true,
      },
      {
        key: 'sick',
        name: { en: 'Sick leave', hi: 'बीमारी अवकाश' },
        paid: true,
        annualQuota: 12,
        quotaYear: 'calendar',
        halfDayAllowed: true,
        attachmentAfterDays: 2,
        active: true,
      },
    ],
  },
  '/v1/calendars': {
    year: 2026,
    items: [
      {
        key: 'standard',
        name: { en: 'Standard', hi: 'सामान्य' },
        weeklyOffs: [7],
        default: true,
        holidays: [
          { date: '2026-10-20', name: 'Diwali', optional: false },
          { date: '2026-11-05', name: 'Guru Nanak Jayanti', optional: true },
        ],
      },
    ],
  },
  '/v1/workflows': {
    fallbackRole: 'manager',
    chains: [
      'leave',
      'regularisation',
      'expense',
      'order',
      'new_account',
      'account_location_change',
      'journey_plan',
      'target_lock',
    ].map((requestType) => ({
      requestType,
      version: requestType === 'leave' ? 2 : 0,
      steps:
        requestType === 'leave'
          ? [
              { approver: { type: 'reporting_manager', level: 1 }, lineDecisions: false },
              {
                approver: { type: 'nearest_designation', designation: 'executive' },
                condition: { match: 'all', clauses: [{ field: 'leave_days', op: 'gt', value: 3 }] },
                reminderAfterHours: 24,
                lineDecisions: false,
              },
            ]
          : [],
      updatedAt: requestType === 'leave' ? '2026-10-20T06:30:00.000Z' : null,
      updatedBy: null,
    })),
  },
  '/v1/users': { items: [], nextCursor: null },
  '/v1/account-types': {
    items: [
      {
        id: TYPE_ID,
        version: 1,
        key: 'customer',
        name: noun('Customer', 'Customers'),
        icon: 'store',
        active: true,
        parentTypes: [],
        code: { mode: 'auto', prefix: 'C' },
        fields: [
          { key: 'gst_number', type: 'short_text', label: { en: 'GST number', hi: 'GST नंबर' } },
        ],
        location: { required: true, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
        creation: 'admins',
        slots: [
          {
            key: 'executive',
            name: { en: 'Executive', hi: 'एग्ज़ीक्यूटिव' },
            designations: ['executive'],
            required: false,
            priority: 1,
          },
        ],
        segmentRules: [
          {
            segment: 'registered',
            name: { en: 'Registered', hi: 'पंजीकृत' },
            when: { match: 'all', clauses: [{ field: 'gst_number', op: 'is_not_empty' }] },
          },
        ],
        visitFrequencyNorms: [{ segment: 'registered', visitsPerMonth: 4 }],
        contacts: true,
      },
    ],
  },
  '/v1/designations': {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000051',
        key: 'executive',
        name: noun('Executive', 'Executives'),
        level: 3,
        ranked: true,
        defaultRole: 'field_user',
        canHaveReports: false,
      },
    ],
  },
  '/v1/roles': { items: [{ key: 'manager', name: { en: 'Manager', hi: 'मैनेजर' } }] },
  '/v1/forms': { items: [] },
  '/v1/territories': {
    items: [],
    levels: [
      { level: 1, key: 'region', name: noun('Region', 'Regions') },
      { level: 2, key: 'area', name: noun('Area', 'Areas') },
    ],
  },
  '/v1/metric-definitions': {
    metrics: [
      {
        active: true,
        version: 1,
        definition: {
          key: 'visits',
          name: noun('Visit', 'Visits'),
          unit: 'count',
          direction: 'higher_is_better',
          targetable: true,
          source: { type: 'plan_compliance_percent' },
        },
      },
    ],
    score: {
      periodType: 'month',
      cap: 1,
      rankingGroupBy: 'designation',
      metrics: [{ metric: 'visits', weight: 100 }],
    },
  },
  '/v1/terminology': {
    overrides: {
      'term.account': {
        en: { one: 'Customer', other: 'Customers' },
        hi: { one: 'ग्राहक', other: 'ग्राहक' },
      },
    },
  },
};

async function mockSignedIn(page: Page, brandColour: string | null = null) {
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
          brandColour,
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
        accountTypes: [],
        forms: [],
        catalogue: {
          units: UNITS,
          measureTypes: ['kg', 'L'],
          itemFields: [],
          rounding: 'per_unit_first',
        },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: [
            'settings.manage',
            'terminology.manage',
            'module.manage',
            'territory.manage',
            'metric.manage',
            'role.manage',
            'designation.manage',
            'form.manage',
            'catalogue.manage',
            'price_list.manage',
            'workflow.manage',
            'calendar.manage',
            'leave_type.manage',
            'expense_policy.manage',
            'billing.manage',
            'api_client.manage',
            'webhook.manage',
          ],
        },
      },
    }),
  );
  for (const prefix of [
    'organisation',
    'terminology',
    'account-types',
    'designations',
    'roles',
    'forms',
    'territories',
    'metric-definitions',
    'workflows',
    'users',
    'catalogue',
    'price-lists',
    'calendars',
    'leave-types',
    'expense-policies',
    'billing',
    'sso',
    'support-grants',
    'audit',
    'announcements',
    'api-clients',
    'webhooks',
  ]) {
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

for (const path of [
  'organisation',
  'rules',
  'terminology',
  'modules',
  'account-types',
  'account-types/new',
  `account-types/${TYPE_ID}`,
  'territory-levels',
  'metrics',
  'metrics/visits',
  'metrics/new',
  'approvals',
  'calendars',
  'leave-types',
  'expense-policies',
  'configuration',
  'catalogue',
  'catalogue/items/new',
  `catalogue/items/${ITEM_ID}`,
  'price-lists',
  'price-lists/new',
  `price-lists/${LIST_ID}`,
  'billing',
  'sso',
  'support',
  'api-clients',
  'webhooks',
]) {
  for (const theme of ['light', 'outdoor']) {
    test(`/settings/${path} passes axe in the ${theme} theme`, async ({ page }) => {
      await mockSignedIn(page);
      await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
      await page.goto(`/settings/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
}

test('opens a webhook’s delivery log and shows a new secret once, accessibly', async ({ page }) => {
  await mockSignedIn(page);
  await page.route('**/v1/webhooks/*/rotate', (route) =>
    route.fulfill({
      json: {
        webhook: (ANSWERS['/v1/webhooks'] as { items: unknown[] }).items[0],
        secret: 'whsec_dGVzdC1zZWNyZXQtb25seS1mb3ItcGxheXdyaWdodA==',
      },
    }),
  );
  await page.goto('/settings/webhooks');
  const erp = page.getByRole('article', { name: 'https://erp.sunrise.example/hooks' });
  await erp.getByText('Delivery log').click();
  await expect(erp.getByRole('table', { name: 'Delivery log' })).toBeVisible();
  await erp.getByRole('button', { name: 'New secret' }).click();
  await erp.getByRole('group').getByRole('button', { name: 'New secret' }).click();
  await expect(
    page.getByRole('region', { name: 'Signing secret for https://erp.sunrise.example/hooks' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("takes the tenant's accent from its brand colour", async ({ page }) => {
  await mockSignedIn(page, '#0f6e6e');
  await page.goto('/settings/organisation');
  await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible();
  const accent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
  await expect.poll(accent).toBe('#0f6e6e');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect.poll(accent).not.toBe('#0f6e6e');
  await expectAccessible(page);
});

test('shows what a configuration file would change, accessibly', async ({ page }) => {
  await mockSignedIn(page);
  await page.route('**/v1/configuration/import/preview', (route) =>
    route.fulfill({
      json: {
        changes: [
          { section: 'accountTypes', key: 'partner', change: 'add' },
          { section: 'geographyLevels', key: 'region', change: 'update' },
          { section: 'roles', key: 'tenant_admin', change: 'kept' },
          { section: 'forms', key: 'meeting', change: 'same' },
        ],
        issues: [],
      },
    }),
  );
  await page.goto('/settings/configuration');
  await page.getByLabel('Choose a file').setInputFiles({
    name: 'staging.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ key: 'generic', version: 1 })),
  });
  await expect(page.getByRole('table', { name: 'What the import does' })).toBeVisible();
  await page.getByRole('checkbox', { name: /entries that are the same/ }).check();
  await page.getByRole('button', { name: 'Import the file' }).click();
  await expect(page.getByRole('group', { name: 'Add 1 and change 1?' })).toBeVisible();
  await expectAccessible(page);
});

test('edits an approval chain, accessibly', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/settings/approvals');
  const leave = page.getByRole('region', { name: 'Leave' });
  await expect(leave.getByText('Version 2', { exact: false })).toBeVisible();
  await leave.getByRole('button', { name: 'Edit: Leave' }).click();
  await expect(leave.getByRole('group', { name: 'Step 2' })).toBeVisible();
  await expect(leave.getByRole('group', { name: 'Use this step only when' })).toBeVisible();
  await expectAccessible(page);
});

for (const theme of ['light', 'outdoor']) {
  test(`vendor support sees whose organisation it is in, and until when, in the ${theme} theme`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await page.route('**/v1/me', (route) =>
      route.fulfill({
        json: {
          userId: '01a10000-0000-7000-8000-0000000000a2',
          tenantId: '01a10000-0000-7000-8000-000000000001',
          cell: 'local',
          code: 'SUPPORT',
          name: 'Ravi Shah',
          designation: 'vendor_support',
          role: 'vendor_support',
          scope: 'tenant',
          permissions: ['settings.manage'],
          deviceId: null,
          calendarKey: null,
          support: {
            grantId: '01a10000-0000-7000-8000-0000000000f2',
            staffName: 'Ravi Shah',
            scope: 'read',
            endsAt: '2099-10-26T06:00:00.000Z',
          },
        },
      }),
    );
    await page.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
    await page.goto('/settings/support');
    await expect(page.getByRole('status')).toContainText('as vendor support, to see only');
    await expect(
      page.getByRole('region', { name: 'Announcements' }).getByText('Planned maintenance'),
    ).toBeVisible();
    await expectAccessible(page);
  });
}
