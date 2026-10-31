import { screen, waitFor, within } from '@testing-library/react';
import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browser } from '../browser';
import { fakeClient, renderAt, writesOf } from '../test-support';

const ASHA = '01a10000-0000-7000-8000-000000000004';
const READY = '01a10000-0000-7000-8000-0000000000e1';
// The page opens on this month, on the tenant's clock.
const PERIOD = todayIn(SETTING_DEFAULTS.timezone).slice(0, 7);

const PAGE = {
  report: 'attendance_register',
  period: PERIOD,
  columns: [
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'user_name', label: 'Name', kind: 'text' },
    {
      key: 'day_status',
      label: 'Status',
      kind: 'status',
      tones: { Present: 'success', Absent: 'danger' },
    },
    { key: 'hours', label: 'Hours', kind: 'number' },
  ],
  rows: [{ date: '2026-10-21', user_name: 'Asha Rao', day_status: 'Present', hours: 8.5 }],
  nextCursor: '1',
};

const EXPORT = {
  id: READY,
  report: 'attendance_register',
  filters: { period: PERIOD },
  format: 'xlsx',
  status: 'ready',
  rows: 31,
  fileName: `attendance-register-${PERIOD}.xlsx`,
  createdAt: '2026-10-21T06:00:00.000Z',
  finishedAt: '2026-10-21T06:00:05.000Z',
  expiresAt: '2026-10-28T06:00:05.000Z',
  download: null,
};

const pages = {
  '/v1/reports/activity_log': { ...PAGE, report: 'activity_log', rows: [], nextCursor: null },
  '/v1/reports/attendance_register': PAGE,
  '/v1/reports/gps_audit_trail': {
    ...PAGE,
    report: 'gps_audit_trail',
    columns: [
      { key: 'captured_at', label: 'Captured at', kind: 'datetime' },
      { key: 'battery', label: 'Battery', kind: 'percent' },
      { key: 'gap_minutes', label: 'Gap before (min)', kind: 'number' },
    ],
    rows: [{ captured_at: '2026-10-21T04:30:00.000Z', battery: 74, gap_minutes: 18 }],
    nextCursor: null,
  },
  '/v1/exports': { items: [EXPORT] },
  '/v1/users': { items: [{ id: ASHA, code: 'SUN-004', name: 'Asha Rao' }], nextCursor: null },
  '/v1/territories': { items: [] },
};

describe('reports (M18)', () => {
  it('reads a report for a month and narrows it to a person', async () => {
    const client = fakeClient(pages, {}, ['report.view', 'user.view']);
    renderAt('/reports', client);
    const user = userEvent.setup();
    expect(await screen.findByText('Nothing to show')).toBeVisible();
    const reports = screen.getByRole('list', { name: 'Report' });
    await user.click(within(reports).getByRole('button', { name: /^Attendance register/ }));
    const table = await screen.findByRole('table', { name: /Attendance register/ });
    expect(within(table).getByRole('columnheader', { name: 'Hours' })).toBeVisible();
    expect(within(table).getByRole('row', { name: /Asha Rao/ })).toHaveTextContent('8.5');
    // A status column's values are badges in their tone.
    expect(within(table).getByText('Present')).toHaveClass('ks-badge', 'success');
    expect(screen.getByRole('button', { name: 'Next' })).toBeVisible();
    // Reports whose records the reader may not see elsewhere aren't offered (D86).
    const offered = within(reports)
      .getAllByRole('button')
      .map((item) => item.querySelector('.ks-title')?.textContent);
    expect(offered).toEqual(expect.arrayContaining(['Visit compliance', 'Location summary']));
    expect(offered).not.toContain('Audit log');
    expect(offered).not.toContain('GPS audit trail');
    expect(offered.some((name) => name?.endsWith('statement'))).toBe(false);
    // Field users can't export; this reader can't either.
    expect(screen.queryByRole('button', { name: 'Download as Excel' })).toBeNull();

    await user.click(screen.getByText('Filters'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Person' }),
      'Asha Rao (SUN-004)',
    );
    // The filter shows as a chip that clears it.
    expect(screen.getByRole('button', { name: 'Clear Person: Asha Rao (SUN-004)' })).toBeVisible();
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(
          new RegExp(
            `^/v1/reports/attendance_register\\?period=${PERIOD}&userId=${ASHA}&locale=en`,
          ),
        ),
        expect.anything(),
      ),
    );
  });

  it('reads the GPS audit trail only once a person is chosen (D99)', async () => {
    const client = fakeClient(pages, {}, [
      'report.view',
      'user.view',
      'trail.view',
      'export.create',
    ]);
    renderAt('/reports', client);
    const user = userEvent.setup();
    expect(await screen.findByText('Nothing to show')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^GPS audit trail/ }));
    expect(await screen.findByText('Choose a person')).toBeVisible();
    expect(screen.getByText(/Points are kept for 35 days/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Download as Excel' })).toBeNull();
    const asked = () =>
      client.request.mock.calls.filter(([, path]) =>
        String(path).startsWith('/v1/reports/gps_audit_trail'),
      );
    expect(asked()).toEqual([]);

    await user.click(screen.getByText('Filters'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Person' }),
      'Asha Rao (SUN-004)',
    );
    const table = await screen.findByRole('table', { name: /GPS audit trail/ });
    expect(within(table).getByRole('row', { name: /74%/ })).toHaveTextContent('18');
    expect(asked()[0]![1]).toContain(`userId=${ASHA}`);
    expect(screen.getByRole('button', { name: 'Download as Excel' })).toBeVisible();
  });

  it('prints what the screen shows, headed with the organisation, filters and time (D99)', async () => {
    const client = fakeClient(pages, {}, ['report.view', 'user.view']);
    document.documentElement.dataset.theme = 'dark';
    renderAt('/reports', client);
    const user = userEvent.setup();
    expect(await screen.findByText('Nothing to show')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Attendance register/ }));
    await user.click(screen.getByText('Filters'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Person' }),
      'Asha Rao (SUN-004)',
    );
    await screen.findByRole('table', { name: /Attendance register/ });
    // The dialog sees one sheet under the body, in the Light theme, and the rows on screen.
    let seen: { sheets: number; text: string; theme: string | undefined } | undefined;
    const print = vi.spyOn(browser, 'print').mockImplementation(() => {
      const sheets = document.querySelectorAll('body > .ks-print-sheet');
      seen = {
        sheets: sheets.length,
        text: sheets[0]?.textContent ?? '',
        theme: document.documentElement.dataset.theme,
      };
    });
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledOnce();
    expect(seen?.sheets).toBe(1);
    expect(seen?.theme).toBe('light');
    expect(seen?.text).toContain('Sunrise Traders');
    expect(seen?.text).toContain('Attendance register');
    expect(seen?.text).toContain(`Month: ${PERIOD}`);
    expect(seen?.text).toContain('Person: Asha Rao (SUN-004)');
    expect(seen?.text).toContain('Read by Anita Rao, whose role reaches: Everyone');
    expect(seen?.text).toMatch(/Printed /);
    expect(seen?.text).toContain('8.5');
    // Once the dialog closes, the page is as it was.
    expect(document.querySelector('.ks-print-sheet')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
    print.mockRestore();
    delete document.documentElement.dataset.theme;
  });

  it('asks for a file, and lists the files with a link to each ready one', async () => {
    const client = fakeClient(
      pages,
      {
        'POST /v1/exports': () => ({
          ...EXPORT,
          status: 'queued',
          id: '01a10000-0000-7000-8000-0000000000e2',
        }),
      },
      ['report.view', 'export.create'],
    );
    renderAt('/reports', client);
    const user = userEvent.setup();
    const files = await screen.findByRole('region', { name: 'Your downloads' });
    expect(await within(files).findByText('Ready')).toBeVisible();
    expect(
      within(files).getByRole('button', { name: `Download attendance-register-${PERIOD}.xlsx` }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Download as CSV' }));
    expect(await screen.findByText(/Your file is being prepared/)).toBeVisible();
    expect(writesOf(client)).toEqual([
      [
        'POST',
        '/v1/exports',
        expect.anything(),
        {
          body: {
            id: expect.any(String),
            report: 'activity_log',
            filters: { period: expect.stringMatching(/^\d{4}-\d{2}$/) },
            format: 'csv',
            locale: 'en',
          },
          idempotencyKey: expect.any(String),
        },
      ],
    ]);
  });

  it('asks for every report as one workbook (D112)', async () => {
    const client = fakeClient(
      pages,
      {
        'POST /v1/exports': () => ({
          ...EXPORT,
          report: 'workbook',
          status: 'queued',
          id: '01a10000-0000-7000-8000-0000000000e3',
        }),
      },
      ['report.view', 'export.create'],
    );
    renderAt('/reports', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Export every report' }));
    expect(await screen.findByText(/Your file is being prepared/)).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { report: 'workbook', format: 'xlsx', locale: 'en' },
    });
  });
});
