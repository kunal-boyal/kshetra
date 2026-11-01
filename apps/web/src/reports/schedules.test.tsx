import { screen, waitFor, within } from '@testing-library/react';
import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderAt, writesOf } from '../test-support';

const ASHA = '01a10000-0000-7000-8000-000000000004';
const OWN = '01a10000-0000-7000-8000-0000000000f1';
const SENT = '01a10000-0000-7000-8000-0000000000f2';
const LINKED = '01a10000-0000-7000-8000-0000000000e2';
const PERIOD = todayIn(SETTING_DEFAULTS.timezone).slice(0, 7);
const ANITA = { id: ADMIN, code: 'SUN-001', name: 'Anita Rao' };
const ASHA_P = { id: ASHA, code: 'SUN-004', name: 'Asha Rao' };

const schedule = (id: string, extra: object = {}) => ({
  id,
  owner: ANITA,
  report: 'attendance_register',
  filters: {},
  format: 'xlsx',
  locale: 'en',
  frequency: 'weekly',
  weekday: 1,
  at: '08:00',
  status: 'active',
  pausedReason: null,
  recipients: [ANITA, ASHA_P],
  nextSend: '2026-11-09',
  createdAt: '2026-11-01T06:00:00.000Z',
  endedAt: null,
  ...extra,
});

const pages = {
  '/v1/reports/activity_log': {
    report: 'activity_log',
    period: PERIOD,
    columns: [],
    rows: [],
    nextCursor: null,
  },
  '/v1/exports': { items: [] },
  [`/v1/exports/${LINKED}`]: {
    id: LINKED,
    report: 'attendance_register',
    filters: { period: PERIOD },
    format: 'xlsx',
    status: 'ready',
    rows: 31,
    fileName: `attendance-register-${PERIOD}.xlsx`,
    createdAt: '2026-11-01T06:00:00.000Z',
    finishedAt: '2026-11-01T06:00:05.000Z',
    expiresAt: '2026-11-08T06:00:05.000Z',
    download: null,
  },
  '/v1/users': { items: [ASHA_P], nextCursor: null },
  '/v1/territories': { items: [] },
  '/v1/report-schedules?for=owner': { items: [schedule(OWN)] },
  '/v1/report-schedules?for=me': {
    items: [schedule(SENT, { owner: ASHA_P, report: 'workbook', recipients: [ANITA] })],
  },
  [`/v1/report-schedules/${OWN}`]: {
    ...schedule(OWN),
    runs: [
      {
        id: '01a10000-0000-7000-8000-0000000000f3',
        sendDate: '2026-11-02',
        period: PERIOD,
        createdAt: '2026-11-02T02:30:00.000Z',
        exports: [
          { user: ANITA, status: 'ready', rows: 31, error: null },
          {
            user: ASHA_P,
            status: 'failed',
            rows: null,
            error: 'The person who asked for this export may no longer export.',
          },
        ],
      },
    ],
  },
};

const SCHEDULER = ['report.view', 'export.create', 'report.schedule', 'user.view'] as const;

describe('scheduled reports (D122)', () => {
  it('schedules the report on screen, to chosen people, every month', async () => {
    const client = fakeClient(pages, { 'POST /v1/report-schedules': () => schedule(OWN) }, [
      ...SCHEDULER,
    ]);
    renderAt('/reports', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule this report' }));
    const form = screen.getByRole('heading', { name: 'Schedule Activity log' }).closest('form')!;
    await user.selectOptions(within(form).getByRole('combobox', { name: 'How often' }), 'monthly');
    expect(within(form).queryByRole('combobox', { name: 'Day' })).toBeNull();
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Send to' }),
      'Asha Rao (SUN-004)',
    );
    await user.click(within(form).getByRole('button', { name: 'Schedule it' }));
    expect(await screen.findByText(/Scheduled\. Each person gets it by email/)).toBeVisible();
    const [call] = writesOf(client);
    expect(call?.[1]).toBe('/v1/report-schedules');
    expect(call?.[3]?.body).toMatchObject({
      report: 'activity_log',
      filters: {},
      format: 'xlsx',
      frequency: 'monthly',
      weekday: null,
      at: '08:00',
      locale: 'en',
      recipients: [ADMIN, ASHA],
    });
  });

  it('lists the person’s schedules with their sends, and stops one sent to them', async () => {
    const client = fakeClient(
      pages,
      {
        [`PUT /v1/report-schedules/${OWN}`]: () => schedule(OWN, { status: 'paused' }),
        [`POST /v1/report-schedules/${SENT}/leave`]: () => schedule(SENT, { recipients: [] }),
      },
      [...SCHEDULER],
    );
    renderAt('/reports?view=scheduled', client);
    const user = userEvent.setup();
    const yours = await screen.findByRole('region', { name: 'Your schedules' });
    expect(
      await within(yours).findByText('Every Monday at 08:00 · To Anita Rao, Asha Rao'),
    ).toBeVisible();
    expect(within(yours).getByText(/Next on/)).toBeVisible();
    await user.click(within(yours).getByRole('button', { name: 'Show sends' }));
    const sends = await within(yours).findByRole('table', { name: 'Latest sends' });
    expect(within(sends).getByText(/may no longer export/)).toBeVisible();

    const received = screen.getByRole('region', { name: 'Sent to you' });
    expect(within(received).getByText('Every report')).toBeVisible();
    await user.click(within(received).getByRole('button', { name: 'Stop sending me this' }));
    const confirm = within(received).getByRole('group', { name: /Stop receiving this report/ });
    await user.click(within(confirm).getByRole('button', { name: 'Stop sending me this' }));
    await waitFor(() =>
      expect(writesOf(client).map(([method, path]) => `${method} ${path}`)).toEqual([
        `POST /v1/report-schedules/${SENT}/leave`,
      ]),
    );
  });

  it('opens the export a scheduled report’s email links to', async () => {
    const client = fakeClient(pages, {}, [...SCHEDULER]);
    renderAt(`/reports?export=${LINKED}`, client);
    const opened = (await screen.findByText('Your scheduled report')).closest('.ks-notice')!;
    expect(
      within(opened as HTMLElement).getByRole('button', {
        name: `Download attendance-register-${PERIOD}.xlsx`,
      }),
    ).toBeVisible();
  });

  it('offers nothing of schedules while the module is off', async () => {
    const client = fakeClient(pages, {}, ['report.view', 'export.create'], {
      settings: { ...SETTING_DEFAULTS, modulesOff: ['advanced_analytics'] },
    });
    renderAt('/reports?view=scheduled', client);
    expect(await screen.findByRole('button', { name: 'Download as Excel' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Scheduled' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schedule this report' })).toBeNull();
  });
});
