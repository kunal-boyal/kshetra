import { ApiError } from '@thelamp/api-client';
import { todayIn } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const PERIOD = todayIn('Asia/Kolkata').slice(0, 7);
const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const RUNNER = ['payroll.run', 'salary.manage', 'user.view'] as const;

const run = (patch: object = {}) => ({
  id: '01a10000-0000-7000-8000-0000000000e1',
  period: PERIOD,
  status: 'draft',
  version: 1,
  rateSet: { id: 'reference-2026-09', from: '2026-09-17' },
  reviewed: false,
  approvedAt: null,
  approvedBy: null,
  totals: { gross: '35000.00', deductions: '3418.00', net: '31582.00', employer: '3961.00' },
  payslips: [
    {
      user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
      gross: '25000.00',
      totalDeductions: '2623.00',
      net: '22377.00',
      flags: [],
    },
    {
      user: { id: RAVI, code: 'SUN-005', name: 'Ravi Kumar' },
      gross: '10000.00',
      totalDeductions: '1275.00',
      net: '8725.00',
      flags: ['no_work_state', 'no_pan'],
    },
  ],
  ...patch,
});

const notFound = () => {
  throw new ApiError(404, 'NOT_FOUND', 'No pay run.');
};

describe('the pay run (D128)', () => {
  it('starts the month’s run when there is none', async () => {
    let started = false;
    const client = fakeClient(
      { [`/v1/pay-runs/${PERIOD}`]: () => (started ? run() : notFound()) },
      {
        'POST /v1/pay-runs': () => {
          started = true;
          return run();
        },
      },
      [...RUNNER],
    );
    renderAt('/pay-run', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start the pay run' }));
    expect(writesOf(client)[0]![3]).toMatchObject({ body: { period: PERIOD } });
    const table = await screen.findByRole('table', { name: /Payslips for/ });
    expect(within(table).getByRole('row', { name: /Asha Rao/ })).toHaveTextContent('₹22,377.00');
    expect(within(table).getByRole('row', { name: /Ravi Kumar/ })).toHaveTextContent(
      'No work state',
    );
  });

  it('says it awaits review, and approves only after asking, at the version seen', async () => {
    const client = fakeClient(
      { [`/v1/pay-runs/${PERIOD}`]: run({ version: 3 }) },
      { [`POST /v1/pay-runs/${PERIOD}/approve`]: () => run({ status: 'approved', version: 4 }) },
      [...RUNNER],
    );
    renderAt('/pay-run', client);
    const user = userEvent.setup();
    expect(await screen.findByText(/Awaiting review by a chartered accountant/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Approve the pay run' }));
    const confirm = screen.getByRole('group', { name: /Approve the pay run for/ });
    expect(writesOf(client)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Approve the pay run' }));
    await waitFor(() =>
      expect(writesOf(client)[0]).toEqual(
        expect.arrayContaining([
          'POST',
          `/v1/pay-runs/${PERIOD}/approve`,
          expect.anything(),
          expect.objectContaining({ body: { version: 3 } }),
        ]),
      ),
    );
  });

  it('adds an adjustment and works the run out again', async () => {
    const client = fakeClient(
      { [`/v1/pay-runs/${PERIOD}`]: run() },
      {
        'POST /v1/pay-adjustments': () => undefined,
        [`POST /v1/pay-runs/${PERIOD}/recompute`]: () => run({ version: 2 }),
      },
      [...RUNNER],
    );
    renderAt('/pay-run', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add an adjustment' }));
    const form = screen.getByRole('form', { name: 'Add an adjustment' });
    await user.selectOptions(within(form).getByRole('combobox', { name: /Person/ }), ASHA);
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'arrears');
    await user.type(within(form).getByRole('textbox', { name: /Amount/ }), '1,000');
    await user.type(within(form).getByRole('textbox', { name: /Why/ }), 'September arrears');
    await user.click(within(form).getByRole('button', { name: 'Add and work it out again' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(2));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { userId: ASHA, period: PERIOD, kind: 'earning', key: 'arrears', amount: '1000' },
    });
    expect(writesOf(client)[1]![1]).toBe(`/v1/pay-runs/${PERIOD}/recompute`);
  });
});

describe('a statutory payslip (D128)', () => {
  it('shows each line, net pay in words and the review label', async () => {
    const client = fakeClient(
      {
        [`/v1/statutory-payslips/${ASHA}/${PERIOD}`]: {
          user: { id: ASHA, code: 'SUN-004', name: 'Asha Rao' },
          period: PERIOD,
          status: 'approved',
          profile: {
            workState: 'MH',
            ptWomen: false,
            pfMember: true,
            pfFullWage: false,
            uan: '100200300400',
            esiNumber: null,
            panOnFile: true,
          },
          structure: {
            basic: '15000.00',
            da: '0.00',
            hra: '6000.00',
            conveyance: '0.00',
            special: '4000.00',
            others: [],
          },
          scheduled: 26,
          paid: 26,
          esiCovered: true,
          wages: '19000.00',
          earnings: [
            { key: 'basic', amount: '15000.00' },
            { key: 'hra', amount: '6000.00' },
            { key: 'special', amount: '4000.00' },
          ],
          deductions: [
            { key: 'pf', amount: '2280.00' },
            { key: 'esi', amount: '143.00' },
            { key: 'pt', amount: '200.00' },
          ],
          employer: [{ key: 'eps', amount: '1583.00' }],
          gross: '25000.00',
          totalDeductions: '2623.00',
          net: '22377.00',
          flags: [],
          rateSetId: 'reference-2026-09',
          reviewed: false,
        },
      },
      {},
      [...RUNNER],
    );
    renderAt(`/pay-run/${ASHA}/${PERIOD}`, client);
    expect(await screen.findByRole('heading', { name: 'Asha Rao · SUN-004' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Deductions' })).toHaveTextContent(
      'Provident fund₹2,280.00',
    );
    expect(screen.getByText('Net pay: ₹22,377.00')).toBeVisible();
    expect(
      screen.getByText('In words: Twenty-two thousand three hundred seventy-seven rupees only'),
    ).toBeVisible();
    expect(screen.getAllByText(/Awaiting review by a chartered accountant/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('100200300400')).toBeVisible();
    expect(screen.getByText('Maharashtra')).toBeVisible();
  });
});

describe('a person’s salary (D128)', () => {
  it('saves a structure from a month and the statutory details', async () => {
    const client = fakeClient(
      {
        [`/v1/users/${ASHA}`]: {
          id: ASHA,
          code: 'SUN-004',
          name: 'Asha Rao',
          phone: '+919000000004',
          email: null,
          designation: 'executive',
          role: 'field_user',
          managerId: null,
          manager: null,
          joiningDate: '2026-04-01',
          exitDate: null,
          calendarKey: null,
          status: 'active',
          territories: [],
          custom: {},
          createdAt: '2026-10-06T07:00:00.000Z',
          updatedAt: '2026-10-06T07:00:00.000Z',
          device: null,
        },
        [`/v1/salary-structures/${ASHA}`]: { userId: ASHA, changes: [] },
        [`/v1/statutory-profiles/${ASHA}`]: {
          userId: ASHA,
          workState: null,
          ptWomen: false,
          pfMember: true,
          pfFullWage: false,
          uan: null,
          esiNumber: null,
          panOnFile: false,
        },
      },
      {
        [`PUT /v1/salary-structures/${ASHA}`]: () => ({ userId: ASHA, changes: [] }),
        [`PUT /v1/statutory-profiles/${ASHA}`]: ({ body }) => ({
          userId: ASHA,
          ...(body as object),
        }),
      },
      [...RUNNER],
    );
    renderAt(`/people/${ASHA}`, client);
    const user = userEvent.setup();
    expect(await screen.findByText('No salary structure yet.')).toBeVisible();
    const structure = screen.getByRole('form', { name: 'A new structure' });
    await user.type(within(structure).getByRole('textbox', { name: /Basic/ }), '15000');
    await user.type(within(structure).getByRole('textbox', { name: /House rent/ }), '6000');
    await user.click(within(structure).getByRole('button', { name: 'Save the structure' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { basic: '15000', hra: '6000', da: '0', conveyance: '0', special: '0' },
    });
    const details = screen.getByRole('form', { name: 'Statutory details' });
    await user.selectOptions(within(details).getByRole('combobox', { name: /Work state/ }), 'MH');
    await user.type(within(details).getByRole('textbox', { name: 'UAN' }), '100200300400');
    await user.click(within(details).getByRole('checkbox', { name: 'PAN on file with you' }));
    await user.click(within(details).getByRole('button', { name: 'Save the details' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(2));
    expect(writesOf(client)[1]![3]).toMatchObject({
      body: { workState: 'MH', uan: '100200300400', panOnFile: true, esiNumber: null },
    });
  });
});
