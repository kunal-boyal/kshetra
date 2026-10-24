import { screen, waitFor, within } from '@testing-library/react';
import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
    { key: 'day_status', label: 'Status', kind: 'text' },
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
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Report' }),
      'Attendance register',
    );
    const table = await screen.findByRole('table', { name: /Attendance register/ });
    expect(within(table).getByRole('columnheader', { name: 'Hours' })).toBeVisible();
    expect(within(table).getByRole('row', { name: /Asha Rao/ })).toHaveTextContent('8.5');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeVisible();
    // Reports whose records the reader may not see elsewhere aren't offered (D86).
    const offered = within(screen.getByRole('combobox', { name: 'Report' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toEqual(expect.arrayContaining(['Visit compliance', 'Location summary']));
    expect(offered).not.toContain('Audit log');
    expect(offered.some((name) => name?.endsWith('statement'))).toBe(false);
    // Field users can't export; this reader can't either.
    expect(screen.queryByRole('button', { name: 'Download as Excel' })).toBeNull();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Person' }),
      'Asha Rao (SUN-004)',
    );
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
});
