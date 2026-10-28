import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** The attendance register and the team's leave (decision D104), against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const RAHUL = '01a10000-0000-7000-8000-000000000004';
const ANITA = '01a10000-0000-7000-8000-000000000005';
const MANAGER = '01a10000-0000-7000-8000-000000000003';
const MONTH = new Date().toISOString().slice(0, 7);
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

function days(pattern: string[]) {
  const [year, month] = MONTH.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => ({
    date: `${MONTH}-${String(index + 1).padStart(2, '0')}`,
    status: pattern[index % pattern.length]!,
  }));
}

const FIX = {
  id: '01a10000-0000-7000-8000-0000000000a2',
  requestType: 'regularisation',
  requestId: '01a10000-0000-7000-8000-0000000000a3',
  subject: { title: '14 Oct', accountId: null, detail: null },
  requester: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
  status: 'pending',
  version: 1,
  steps: [
    {
      index: 0,
      approvers: [{ id: MANAGER, code: 'SUN-003', name: 'Priya Nair' }],
      status: 'pending',
      actedBy: null,
      actedAt: null,
      note: null,
      skipReason: null,
      escalated: false,
      fallback: false,
    },
  ],
  cancellable: true,
  bulk: true,
  page: null,
  createdAt: '2026-10-01T07:00:00.000Z',
  closedAt: null,
};

const ANSWERS: Record<string, unknown> = {
  '/v1/attendance/register': {
    period: MONTH,
    items: [
      {
        user: { id: RAHUL, code: 'SUN-004', name: 'Rahul Verma' },
        days: days(['present', 'present', 'half_day', 'paid_leave', 'absent', 'weekly_off']),
        present: 12.5,
      },
      {
        user: { id: ANITA, code: 'SUN-005', name: 'Anita Rao' },
        days: days(['present', 'present', 'present', 'present', 'present', 'weekly_off']),
        present: 25,
      },
    ],
    nextCursor: null,
  },
  '/v1/approvals/inbox?requestType=leave': {
    items: [],
    nextCursor: null,
    counts: { regularisation: 1 },
  },
  '/v1/approvals/inbox?requestType=regularisation': {
    items: [FIX],
    nextCursor: null,
    counts: { regularisation: 1 },
  },
  '/v1/territories': { items: [] },
  '/v1/leave-types': {
    items: [
      {
        key: 'casual',
        name: { en: 'Casual', hi: 'आकस्मिक' },
        paid: true,
        annualQuota: 12,
        quotaYear: 'calendar',
        halfDayAllowed: true,
        active: true,
      },
    ],
  },
  '/v1/leave-requests': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        userId: ANITA,
        leaveType: 'casual',
        startDate: `${MONTH}-09`,
        endDate: `${MONTH}-10`,
        halfDay: false,
        days: 2,
        reason: null,
        attachmentId: null,
        state: 'pending',
        approval: null,
        createdAt: '2026-10-01T07:00:00.000Z',
        decidedAt: null,
      },
    ],
    people: [{ id: ANITA, code: 'SUN-005', name: 'Anita Rao' }],
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
        catalogue: { units: [], measureTypes: [] },
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['user.view', 'approval.act', 'report.view'],
        },
      },
    }),
  );
  for (const prefix of [
    'attendance',
    'leave-requests',
    'leave-types',
    'territories',
    'approvals',
  ]) {
    await page.route(`**/v1/${prefix}**`, (route) => {
      const url = new URL(route.request().url());
      const answer = ANSWERS[`${url.pathname}${url.search}`] ?? ANSWERS[url.pathname];
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

test('the attendance register shows everyone by day, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/attendance');
  await expect(page.getByRole('heading', { level: 1, name: /^Attendance · / })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rahul Verma/ })).toContainText('12.5');
  await expect(page.getByRole('region', { name: /Waiting for a decision · 1/ })).toContainText(
    'Rahul Verma · 14 Oct',
  );
  await expectAccessible(page);
});

test('the team’s leave passes axe in the outdoor theme', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/attendance');
  await page.getByRole('tab', { name: 'Leave' }).click();
  await expect(page.getByRole('row', { name: /Anita Rao/ })).toContainText('Casual');
  await expectAccessible(page);
});
