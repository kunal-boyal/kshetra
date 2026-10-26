import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Reports and exports (M18) in the built portal, against a mocked API, with axe. */

const ORIGIN = 'http://127.0.0.1:4173';
const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: ORIGIN,
};
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const PERIOD = new Date().toISOString().slice(0, 7);

const columns = (labels: [string, string, string][]) =>
  labels.map(([key, label, kind]) => ({ key, label, kind }));

/** What the cell answers to a GET, by path. */
const ANSWERS: Record<string, unknown> = {
  '/v1/reports/activity_log': {
    report: 'activity_log',
    period: PERIOD,
    columns: columns([
      ['captured_at', 'Filled at', 'datetime'],
      ['user_name', 'Name', 'text'],
      ['form', 'Form', 'text'],
      ['geofence', 'Geofence', 'text'],
      ['distance', 'Distance (m)', 'number'],
    ]),
    rows: [
      {
        captured_at: '2026-10-21T05:00:00.000Z',
        user_name: 'Asha Rao',
        form: 'Shop visit',
        geofence: 'Inside the geofence',
        distance: 40,
      },
    ],
    nextCursor: null,
  },
  '/v1/exports': {
    items: [
      {
        id: '01a10000-0000-7000-8000-0000000000e1',
        report: 'activity_log',
        filters: { period: PERIOD },
        format: 'xlsx',
        status: 'ready',
        rows: 1,
        fileName: `activity-log-${PERIOD}.xlsx`,
        createdAt: '2026-10-21T06:00:00.000Z',
        finishedAt: '2026-10-21T06:00:05.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
        download: null,
      },
    ],
  },
  '/v1/territories': { items: [] },
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
          permissions: ['report.view', 'export.create'],
        },
      },
    }),
  );
  for (const prefix of ['reports', 'exports', 'territories']) {
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

test('/reports shows a report and the files made from it, and passes axe', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Inside the geofence' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Download activity-log-${PERIOD}.xlsx` }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('/reports passes axe in the outdoor theme', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'outdoor'));
  await page.goto('/reports');
  await expect(page.getByRole('cell', { name: 'Asha Rao' })).toBeVisible();
  await expectAccessible(page);
});

test('/reports prints the report alone, headed, in the Light theme (D99)', async ({ page }) => {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    // The dialog, standing in: it records what the printed page holds while it is open.
    window.print = () => {
      const sheet = document.querySelector<HTMLElement>('body > .ks-print-sheet');
      const shown = (element: Element | null) =>
        element ? getComputedStyle(element).display !== 'none' : false;
      (window as unknown as { printed: unknown }).printed = {
        sheet: shown(sheet),
        page: shown(document.getElementById('root')),
        buttons: [...(sheet?.querySelectorAll('button') ?? [])].filter(shown).length,
        theme: document.documentElement.dataset.theme,
        text: sheet?.textContent ?? '',
      };
      // As a browser does once its dialog closes.
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.goto('/reports');
  await expect(page.getByRole('cell', { name: 'Asha Rao' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await page.getByRole('button', { name: 'Print' }).click();
  const printed = await page.evaluate(() => (window as unknown as { printed: unknown }).printed);
  await page.emulateMedia({ media: 'screen' });
  expect(printed).toEqual({
    sheet: true,
    page: false,
    buttons: 0,
    theme: 'light',
    text: expect.stringContaining('Activity log'),
  });
  await expect(page.locator('.ks-print-sheet')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
