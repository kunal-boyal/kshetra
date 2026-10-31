import { ApiError } from '@thelamp/api-client';
import { todayIn } from '@thelamp/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const PERIOD = todayIn('Asia/Kolkata').slice(0, 7);
const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const month = (patch: object) => ({
  user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao', designation: 'executive' },
  period: PERIOD,
  monthlyGross: '30000.00',
  scheduled: 26,
  paid: 12,
  amount: '13846.15',
  toDate: true,
  ...patch,
});
const PAGES = {
  '/v1/payroll': {
    items: [
      month({}),
      month({
        user: { id: RAVI, code: 'SUN-005', name: 'Ravi Kumar', designation: 'executive' },
        monthlyGross: null,
        amount: null,
        paid: 10,
      }),
    ],
    nextCursor: null,
  },
  [`/v1/payslips/${ASHA}/${PERIOD}`]: {
    ...month({}),
    days: {
      future: 4,
      not_employed: 0,
      present: 11,
      half_day: 2,
      paid_leave: 0,
      unpaid_leave: 1,
      holiday: 1,
      weekly_off: 4,
      absent: 7,
    },
  },
};

describe('payroll inputs (M14, decision D117)', () => {
  it('shows the month’s estimates, and sets a gross from a month', async () => {
    const client = fakeClient(
      PAGES,
      {
        [`PUT /v1/payroll-gross/${RAVI}`]: (options) => {
          const body = (options as { body: { from: string } }).body;
          if (body.from < PERIOD) {
            throw new ApiError(422, 'VALIDATION', 'Check the highlighted fields.', [
              { path: 'from', issue: `Start in ${PERIOD} or later, when the gross last changed` },
            ]);
          }
          return { userId: RAVI, changes: [{ from: PERIOD, monthlyGross: '24000.00' }] };
        },
      },
      ['payroll.manage', 'report.view'],
    );
    renderAt('/payroll', client);
    const table = await screen.findByRole('table', { name: 'Payroll' });
    const asha = within(table).getByRole('row', { name: /Asha Rao/ });
    expect(asha).toHaveTextContent('₹30,000.00');
    expect(asha).toHaveTextContent('12 of 26');
    expect(asha).toHaveTextContent('₹13,846.15');
    expect(asha).toHaveTextContent('so far this month');
    const ravi = within(table).getByRole('row', { name: /Ravi Kumar/ });
    expect(ravi).toHaveTextContent('No gross yet');
    expect(
      screen.getByText('Attendance-based estimate. This is not a statutory payroll document.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Payroll' })).toBeVisible();

    const user = userEvent.setup();
    await user.click(within(ravi).getByRole('button', { name: 'Set gross: Ravi Kumar' }));
    const form = screen.getByRole('form', { name: 'Monthly gross for Ravi Kumar' });
    await user.type(within(form).getByRole('textbox', { name: /^Monthly gross/ }), '24,000');
    const from = within(form).getByLabelText(/^From month/);
    expect(from).toHaveValue(PERIOD);
    await user.clear(from);
    await user.type(from, '2000-01');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(form).findByText(`Start in ${PERIOD} or later, when the gross last changed`),
    ).toBeVisible();
    await user.clear(from);
    await user.type(from, PERIOD);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('table', { name: 'Payroll' })).toBeVisible();
    expect(screen.queryByRole('form', { name: /Monthly gross for/ })).toBeNull();
    expect(
      writesOf(client).map(([method, path, , options]) => [method, path, options?.body]),
    ).toEqual([
      ['PUT', `/v1/payroll-gross/${RAVI}`, { monthlyGross: '24000', from: '2000-01' }],
      ['PUT', `/v1/payroll-gross/${RAVI}`, { monthlyGross: '24000', from: PERIOD }],
    ]);
  });

  it('previews a payslip with its days and the estimate, ready to print', async () => {
    renderAt(`/payroll/${ASHA}/${PERIOD}`, fakeClient(PAGES, {}, ['payroll.manage']));
    expect(await screen.findByRole('heading', { name: 'Asha Rao · SUN-004' })).toBeVisible();
    const days = screen.getByRole('table', { name: 'Days' });
    expect(within(days).getByRole('row', { name: /Present/ })).toHaveTextContent('11');
    expect(within(days).getByRole('row', { name: /Half days/ })).toHaveTextContent('2');
    expect(screen.getByText('Provisional pay so far: ₹13,846.15')).toBeVisible();
    expect(screen.getAllByText(/^Attendance-based estimate/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Print/ })).toBeVisible();
  });
});
