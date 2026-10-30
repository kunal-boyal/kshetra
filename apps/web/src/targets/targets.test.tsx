import { formatMonth, formatPeriod } from '@thelamp/i18n';
import { periodOf, previousPeriod, SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const RAHUL = '01a10000-0000-7000-8000-000000000004';
const SURESH = '01a10000-0000-7000-8000-000000000005';
const ADMIN = '01a10000-0000-7000-8000-000000000002';
const PERIOD = todayIn(SETTING_DEFAULTS.timezone).slice(0, 7);
const [YEAR, MONTH] = PERIOD.split('-').map(Number) as [number, number];
const PREVIOUS = MONTH === 1 ? `${YEAR - 1}-12` : `${YEAR}-${String(MONTH - 1).padStart(2, '0')}`;

const METRICS = [
  {
    key: 'visits',
    name: noun('Visit', 'Visits'),
    unit: 'count',
    direction: 'higher_is_better',
    targetable: true,
  },
  {
    key: 'sales',
    name: noun('Sale', 'Sales'),
    unit: 'currency',
    direction: 'higher_is_better',
    targetable: true,
  },
];

function set(
  id: string,
  name: string,
  status: 'none' | 'draft' | 'locked',
  values: Record<string, string> = {},
  version = 0,
) {
  return {
    user: { id, code: `SUN-${id.slice(-3)}`, name },
    period: PERIOD,
    status,
    values,
    lockedAt: status === 'locked' ? '2026-10-02T07:00:00.000Z' : null,
    lockedBy: status === 'locked' ? { id: ADMIN, name: 'Asha Mehta' } : null,
    version,
  };
}

const LIST = {
  period: PERIOD,
  metrics: METRICS,
  sets: [
    set(RAHUL, 'Rahul Verma', 'draft', { visits: '40', sales: '150000.00' }, 2),
    set(SURESH, 'Suresh Rao', 'locked', { visits: '30' }, 1),
  ],
  own: set(ADMIN, 'Asha Mehta', 'none'),
  totals: { visits: '70', sales: '150000.00' },
};

const ALL = ['target.view', 'target.edit', 'target.lock', 'target.unlock'] as const;

describe('targets (M8)', () => {
  it('shows the month by person with totals, and saves an edited draft with its version', async () => {
    const client = fakeClient(
      { '/v1/targets': LIST },
      { 'PUT /v1/targets': () => ({ sets: [] }) },
      ALL,
    );
    renderAt('/targets', client);
    const table = await screen.findByRole('table', { name: 'Targets for the month, by person' });
    expect(within(table).getByRole('row', { name: /Suresh Rao/ })).toHaveTextContent('Locked');
    expect(within(table).getByRole('row', { name: /Team total/ })).toHaveTextContent('70');
    expect(within(table).getByRole('row', { name: /Your own/ })).toHaveTextContent('Not set');
    // A locked set can't be edited in place.
    expect(screen.queryByRole('textbox', { name: 'Visit for Suresh Rao' })).toBeNull();

    const user = userEvent.setup();
    const visits = screen.getByRole('textbox', { name: 'Visit for Rahul Verma' });
    await user.clear(visits);
    await user.type(visits, '4.5');
    expect(await screen.findByRole('alert')).toHaveTextContent('Rahul Verma, Visit');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(visits);
    await user.type(visits, '45');
    await user.clear(screen.getByRole('textbox', { name: 'Sale for Rahul Verma' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'PUT',
          '/v1/targets',
          expect.anything(),
          {
            body: {
              period: PERIOD,
              sets: [{ userId: RAHUL, version: 2, values: { visits: '45', sales: null } }],
            },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
    expect(await screen.findByText('Changes saved.')).toHaveAttribute('role', 'status');
  });

  it('locks and copies the people chosen, after asking', async () => {
    const client = fakeClient(
      { '/v1/targets': LIST },
      {
        'POST /v1/targets/lock': () => ({ locked: [RAHUL], skipped: [] }),
        'POST /v1/targets/copy': () => ({
          copied: [],
          skipped: [{ userId: RAHUL, reason: 'NOTHING_TO_COPY' }],
        }),
      },
      ALL,
    );
    renderAt('/targets', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Rahul Verma' }));
    await user.click(screen.getByRole('button', { name: 'Lock 1 person' }));
    expect(screen.getByText('Lock the targets of 1 person?')).toBeVisible();
    expect(writesOf(client)).toEqual([]);
    const lockButtons = screen.getAllByRole('button', { name: 'Lock 1 person' });
    await user.click(lockButtons[lockButtons.length - 1]!);
    expect(await screen.findByText('Targets locked for 1 person.')).toHaveAttribute(
      'role',
      'status',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Rahul Verma' }));
    await user.click(screen.getByRole('button', { name: 'Copy for 1 person' }));
    const previous = formatMonth(PREVIOUS, { locale: 'en' });
    expect(screen.getByText(`Copy ${previous}’s targets for 1 person?`)).toBeVisible();
    const copyButtons = screen.getAllByRole('button', { name: 'Copy for 1 person' });
    await user.click(copyButtons[copyButtons.length - 1]!);
    await waitFor(() =>
      expect(writesOf(client).map(([method, path, , options]) => [method, path, options])).toEqual([
        [
          'POST',
          '/v1/targets/lock',
          { body: { period: PERIOD, userIds: [RAHUL] }, idempotencyKey: expect.any(String) },
        ],
        [
          'POST',
          '/v1/targets/copy',
          {
            body: { period: PERIOD, from: PREVIOUS, userIds: [RAHUL] },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
  });

  it('counts the month, shows units, selects everyone and discards edits', async () => {
    const client = fakeClient({ '/v1/targets': LIST }, {}, ALL);
    renderAt('/targets', client);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Targets for the month, by person' });
    // The month at a glance, and each metric's unit beside its heading.
    expect(screen.getByText('2 people')).toBeVisible();
    expect(screen.getByText('1 locked')).toBeVisible();
    expect(screen.getByText('1 in draft')).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: /^Sales\s*₹$/ })).toBeVisible();
    // A locked set reads as figures, by unit, with who locked it.
    expect(within(table).getByRole('row', { name: /Suresh Rao/ })).toHaveTextContent(
      'Locked by Asha Mehta',
    );
    expect(within(table).getByRole('row', { name: /Team total/ })).toHaveTextContent('₹1,50,000');

    await user.click(screen.getByRole('checkbox', { name: 'Select everyone' }));
    expect(screen.getByText('2 selected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('2 selected')).toBeNull();

    const visits = screen.getByRole('textbox', { name: 'Visit for Rahul Verma' });
    await user.clear(visits);
    await user.type(visits, '45');
    expect(screen.getByText('1 change not saved')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('textbox', { name: 'Visit for Rahul Verma' })).toHaveValue('40');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(writesOf(client)).toEqual([]);
  });

  it('steps between months, starting each one afresh', async () => {
    const client = fakeClient({ '/v1/targets': LIST }, {}, ALL);
    renderAt('/targets', client);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Visit for Rahul Verma' }), '5');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('group', { name: 'Month' })).toHaveTextContent(
      formatMonth(PREVIOUS, { locale: 'en' }),
    );
    await waitFor(() =>
      expect(client.request.mock.calls.map(([method, path]) => `${method} ${path}`)).toContain(
        `GET /v1/targets?period=${PREVIOUS}`,
      ),
    );
    expect(screen.queryByText(/change not saved/)).toBeNull();
  });

  it('unlocks only with a reason', async () => {
    const client = fakeClient(
      { '/v1/targets': LIST },
      { 'POST /v1/targets/unlock': () => set(SURESH, 'Suresh Rao', 'draft', { visits: '30' }, 2) },
      ALL,
    );
    renderAt('/targets', client);
    const user = userEvent.setup();
    const suresh = await screen.findByRole('row', { name: /Suresh Rao/ });
    await user.click(within(suresh).getByRole('button', { name: 'Unlock' }));
    const section = screen.getByRole('region', { name: 'Unlock the targets of Suresh Rao' });
    const unlock = within(section).getByRole('button', { name: 'Unlock' });
    await user.type(within(section).getByRole('textbox', { name: /Reason/ }), 'Too short');
    expect(unlock).toBeDisabled();
    await user.type(within(section).getByRole('textbox', { name: /Reason/ }), ' after all');
    await user.click(unlock);
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'POST',
          '/v1/targets/unlock',
          expect.anything(),
          {
            body: { userId: SURESH, period: PERIOD, reason: 'Too short after all' },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
    expect(await screen.findByText('Targets of Suresh Rao unlocked.')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('shows the grid read only to those who only view it', async () => {
    renderAt('/targets', fakeClient({ '/v1/targets': LIST }, {}, ['target.view']));
    const table = await screen.findByRole('table', { name: 'Targets for the month, by person' });
    expect(within(table).getByRole('row', { name: /Rahul Verma/ })).toHaveTextContent('40');
    expect(screen.queryByRole('textbox', { name: /for Rahul Verma/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('counts by the quarter where the tenant does (D108)', async () => {
    const quarter = periodOf('quarter', todayIn(SETTING_DEFAULTS.timezone), 4);
    const client = fakeClient({ '/v1/targets': { ...LIST, period: quarter } }, {}, ALL, {
      targetPeriods: { periodType: 'quarter' },
    });
    renderAt('/targets', client);
    const user = userEvent.setup();
    const stepper = await screen.findByRole('group', { name: 'Quarter' });
    expect(stepper).toHaveTextContent(formatPeriod(quarter, 4, { locale: 'en' }));
    await waitFor(() =>
      expect(client.request.mock.calls.map(([method, path]) => `${method} ${path}`)).toContain(
        `GET /v1/targets?period=${quarter}`,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Previous quarter' }));
    await waitFor(() =>
      expect(client.request.mock.calls.map(([method, path]) => `${method} ${path}`)).toContain(
        `GET /v1/targets?period=${previousPeriod(quarter)}`,
      ),
    );
  });
});
