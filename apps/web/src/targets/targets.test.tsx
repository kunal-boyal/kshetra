import { SETTING_DEFAULTS, todayIn } from '@kshetra/shared';
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
    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
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
    expect(await screen.findByRole('status')).toHaveTextContent('Targets locked for 1 person.');

    await user.click(screen.getByRole('checkbox', { name: 'Select Rahul Verma' }));
    await user.click(screen.getByRole('button', { name: 'Copy for 1 person' }));
    expect(screen.getByText(`Copy ${PREVIOUS}’s targets for 1 person?`)).toBeVisible();
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
    expect(await screen.findByRole('status')).toHaveTextContent('Targets of Suresh Rao unlocked.');
  });

  it('shows the grid read only to those who only view it', async () => {
    renderAt('/targets', fakeClient({ '/v1/targets': LIST }, {}, ['target.view']));
    const table = await screen.findByRole('table', { name: 'Targets for the month, by person' });
    expect(within(table).getByRole('row', { name: /Rahul Verma/ })).toHaveTextContent('40');
    expect(screen.queryByRole('textbox', { name: /for Rahul Verma/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
