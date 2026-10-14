import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Accounts and approvals (M4, D38) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const SHOP = '01a10000-0000-7000-8000-000000000080';
const DEPOT = '01a10000-0000-7000-8000-000000000081';
const MARKET = '01a10000-0000-7000-8000-000000000010';
const ASM = '01a10000-0000-7000-8000-000000000003';
const SME = '01a10000-0000-7000-8000-000000000004';
const APPROVAL = '01a10000-0000-7000-8000-000000000090';
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const text = (en: string) => ({ en, hi: en });

const DISTRIBUTOR = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'distributor',
  name: noun('Distributor', 'Distributors'),
  icon: 'warehouse',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [
    { key: 'annual_revenue', type: 'currency', label: text('Annual revenue'), required: false },
  ],
  location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'field_users_with_approval',
  slots: [
    { key: 'sme', name: text('SME'), designations: ['sme'], required: false, priority: 1 },
    { key: 'asm', name: text('ASM'), designations: ['asm'], required: true, priority: 3 },
  ],
  segmentRules: [
    {
      segment: 'commercially_active',
      name: text('Commercially active'),
      when: { match: 'all', clauses: [{ field: 'annual_revenue', op: 'gt', value: '500000' }] },
    },
  ],
  visitFrequencyNorms: [],
  contacts: true,
};

function account(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'distributor',
    code: `D-${id.slice(-2)}`,
    name,
    territory: { id: MARKET, code: 'N-DEL', name: 'Delhi Market' },
    parent: null,
    address: { city: 'Delhi', pin: '110001' },
    location: { lat: 28.6315, lng: 77.2167 },
    geofenceRadiusM: null,
    locationStatus: 'verified',
    status: 'active',
    segments: ['commercially_active'],
    custom: { annual_revenue: '750000.00' },
    slots: [
      {
        slot: 'asm',
        user: { id: ASM, code: 'SUN-003', name: 'Arjun Singh' },
        validFrom: '2026-10-01',
      },
      {
        slot: 'sme',
        user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        validFrom: '2026-10-01',
      },
    ],
    primarySlot: 'sme',
    missingSlots: [],
    createdAt: '2026-10-01T07:00:00.000Z',
    updatedAt: '2026-10-01T07:00:00.000Z',
    ...overrides,
  };
}

const SHOP_ACCOUNT = account(SHOP, 'Green Fields Agro');
const ANSWERS: Record<string, unknown> = {
  '/v1/accounts': {
    items: [
      SHOP_ACCOUNT,
      account(DEPOT, 'Beej Bhandar', {
        status: 'pending',
        segments: [],
        location: null,
        locationStatus: 'unverified',
      }),
    ],
    nextCursor: null,
  },
  '/v1/submissions': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        form: {
          key: 'shop_visit',
          version: 1,
          name: {
            en: { one: 'Shop visit', other: 'Shop visits' },
            hi: { one: 'दुकान विज़िट', other: 'दुकान विज़िट' },
          },
        },
        account: { id: SHOP, code: 'D-1', name: 'Green Fields Agro' },
        visitId: null,
        shiftId: null,
        capturedAt: '2026-10-13T06:00:00.000Z',
        receivedAt: '2026-10-13T06:00:05.000Z',
        location: { lat: 28.6315, lng: 77.2167 },
        accuracy: 12,
        distanceM: 40,
        geofence: 'inside',
        values: {},
        photos: ['01a10000-0000-7000-8000-0000000000f1'],
        signatureMediaId: null,
        flags: [],
        status: 'approved',
      },
    ],
    nextCursor: null,
  },
  [`/v1/accounts/${SHOP}/overview`]: {
    account: SHOP_ACCOUNT,
    contacts: [
      {
        id: '01a10000-0000-7000-8000-000000000085',
        accountId: SHOP,
        name: 'Meena Shah',
        role: 'Owner',
        phone: '+919876543210',
        email: null,
        active: true,
      },
    ],
    assignments: [
      {
        slot: 'sme',
        user: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        validFrom: '2026-10-01',
        validTo: null,
      },
      {
        slot: 'asm',
        user: { id: ASM, code: 'SUN-003', name: 'Arjun Singh' },
        validFrom: '2026-10-01',
        validTo: null,
      },
    ],
    locationProposals: [
      {
        id: '01a10000-0000-7000-8000-000000000086',
        accountId: SHOP,
        point: { lat: 28.6315, lng: 77.2167 },
        accuracy: 12,
        capturedAt: '2026-10-11T05:00:00.000Z',
        status: 'approved',
        proposedBy: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        approvalId: APPROVAL,
        createdAt: '2026-10-11T05:00:00.000Z',
      },
    ],
    approvalId: null,
  },
  '/v1/territories': {
    items: [
      { id: MARKET, parentId: null, level: 1, code: 'N-DEL', name: 'Delhi Market', active: true },
    ],
    levels: [{ level: 1, key: 'market', name: noun('Market', 'Markets') }],
  },
  '/v1/approvals/inbox': {
    items: [
      {
        id: APPROVAL,
        requestType: 'new_account',
        requestId: DEPOT,
        subject: { title: 'Beej Bhandar (D-81)', accountId: DEPOT },
        requester: { id: SME, code: 'SUN-004', name: 'Suresh Rao' },
        status: 'pending',
        version: 1,
        steps: [],
        createdAt: '2026-10-12T05:00:00.000Z',
        closedAt: null,
      },
    ],
    nextCursor: null,
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
          targetUnlockByAdmin: false,
          ordersNeedOpenShift: true,
          ordersAllowedOffline: true,
        },
        terminology: {},
        designations: [],
        accountTypes: [DISTRIBUTOR],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['user.view', 'account.view', 'account.manage', 'approval.act'],
        },
      },
    }),
  );
  for (const prefix of ['accounts', 'territories', 'approvals', 'submissions']) {
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
  { path: '/accounts', heading: 'Distributors', shows: 'Green Fields Agro' },
  { path: `/accounts/${SHOP}`, heading: 'Green Fields Agro', shows: 'Meena Shah' },
  {
    path: '/accounts/new?type=distributor',
    heading: 'Add Distributor',
    shows: 'Who looks after it',
  },
  {
    path: `/accounts/${SHOP}/edit`,
    heading: 'Edit Green Fields Agro',
    shows: 'Changes to these apply from',
  },
  { path: '/approvals', heading: 'Approvals', shows: 'Beej Bhandar (D-81)' },
];

for (const { path, heading, shows } of PAGES) {
  test(`${path} shows its data and passes axe`, async ({ page }) => {
    await mockSignedIn(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    await expectAccessible(page);
  });
}

test('an account and the inbox pass axe in the outdoor theme', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto(`/accounts/${SHOP}`);
  await expect(page.getByRole('region', { name: 'Location', exact: true })).toContainText(
    '28.631500',
  );
  await expectAccessible(page);
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByRole('textbox', { name: /Why are you rejecting it/ })).toBeVisible();
  await expectAccessible(page);
});
