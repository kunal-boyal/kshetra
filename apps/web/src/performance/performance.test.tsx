import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt } from '../test-support';

const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const PERIOD = '2026-10';

const metric = (key: string, one: string, unit: string, overrides: object = {}) => ({
  key,
  name: noun(one, `${one}s`),
  unit,
  direction: 'higher_is_better',
  targetable: true,
  available: true,
  weight: null,
  ...overrides,
});

const METRICS = [
  metric('calls', 'Call', 'count', { weight: 50 }),
  metric('amount', 'Sale', 'currency', { weight: 50 }),
  metric('reach', 'Coverage', 'percent'),
  metric('order_value', 'Order', 'currency', { available: false }),
];

const figures = (actual: string | null, target: string | null = null, extra: object = {}) => ({
  actual,
  pending: null,
  target,
  attainment: actual !== null && target !== null ? Number(actual) / Number(target) : null,
  ...extra,
});

const person = (id: string, name: string) => ({ id, code: `SUN-${id.slice(-3)}`, name });

const MONTH = {
  period: PERIOD,
  user: person(ASHA, 'Asha Rao'),
  territory: { code: 'IND-W', name: 'Indore West' },
  metrics: METRICS,
  figures: {
    calls: figures('2', '4', { pending: '1' }),
    amount: figures('150.5', '301'),
    reach: figures('50'),
    order_value: figures(null),
  },
  locked: true,
  score: 50,
  rank: 2,
  previousRank: 4,
  group: { key: 'executive', name: noun('Executive', 'Executives'), size: 2 },
  days: [{ date: '2026-10-14', values: { calls: '2', amount: '150.5' } }],
};

describe('performance (M9)', () => {
  it("shows a person's month as tiles with pending apart, score, rank and the trend", async () => {
    renderAt(
      `/performance/${ASHA}`,
      fakeClient(
        { '/v1/performance': MONTH, '/v1/submissions': { items: [], nextCursor: null } },
        {},
        ['performance.view_team', 'user.view'],
      ),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Asha Rao’s month' }),
    ).toBeVisible();
    expect(screen.getByText('Executive · Indore West')).toBeVisible();
    expect(screen.getByText('2 of 2')).toBeVisible();
    expect(screen.getByText('Up 2')).toBeVisible();
    expect(screen.getByText('+1 pending')).toBeVisible();
    expect(screen.getAllByText('50%', { selector: 'b' })).toHaveLength(2);
    expect(screen.getByText('No target set')).toBeVisible();
    expect(screen.getByText('Not yet counted')).toBeVisible();
    const trend = screen.getByRole('table', { name: 'Approved values for each day of the month' });
    expect(within(trend).getAllByRole('row')[1]).toHaveTextContent('2');
    expect(screen.getByRole('region', { name: 'Forms filled' })).toBeVisible();
  });

  it('says why there is no score while targets are drafts', async () => {
    renderAt(
      '/performance/me',
      fakeClient({ '/v1/performance': { ...MONTH, locked: false, score: null, rank: null } }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'My month' })).toBeVisible();
    expect(await screen.findByText(/No score yet/)).toBeVisible();
    expect(screen.getAllByText('Draft target').length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Forms filled' })).toBeNull();
  });

  it("shows the team's month with ranks and totals, leaving out what isn't counted yet", async () => {
    renderAt(
      '/performance',
      fakeClient(
        {
          '/v1/performance/team': {
            period: PERIOD,
            metrics: METRICS,
            rows: [
              {
                user: person(RAVI, 'Ravi Kumar'),
                designation: 'executive',
                territory: null,
                figures: { calls: figures('1') },
                score: null,
                rank: null,
                previousRank: null,
              },
              {
                user: person(ASHA, 'Asha Rao'),
                designation: 'executive',
                territory: { code: 'IND-W', name: 'Indore West' },
                figures: MONTH.figures,
                score: 50,
                rank: 2,
                previousRank: 2,
              },
            ],
            totals: { calls: figures('3', '4'), amount: figures('150.5', '301') },
          },
        },
        {},
        ['performance.view_team'],
      ),
    );
    const table = await screen.findByRole('table', {
      name: 'The month for each person, by metric, with score and rank',
    });
    expect(within(table).queryByRole('columnheader', { name: 'Orders' })).toBeNull();
    // Ranked people first, rank in the first column, attainment with the actual on hover.
    const [asha, ravi] = within(table).getAllByRole('row').slice(1);
    expect(within(asha!).getAllByRole('cell')[0]).toHaveTextContent('2');
    expect(within(asha!).getByLabelText('Rank 2')).toBeVisible();
    expect(asha).toHaveTextContent('Indore West');
    expect(within(asha!).getAllByText('50%')[0]).toHaveAttribute('title', '2');
    expect(asha).toHaveTextContent('Same');
    expect(ravi).toHaveTextContent('Not ranked');
    expect(within(table).getByRole('row', { name: /Team total/ })).toHaveTextContent('3 of 4');
    expect(within(table).getByRole('link', { name: 'Asha Rao' })).toHaveAttribute(
      'href',
      `/performance/${ASHA}`,
    );
  });

  it('ranks the group with territories, movement and the score’s mix, marking the viewer', async () => {
    const row = (id: string, name: string, extra: object) => ({
      user: person(id, name),
      territory: null,
      figures: { calls: figures('2', '4'), amount: figures('150.5', '301') },
      ...extra,
    });
    const client = fakeClient(
      {
        '/v1/leaderboard': {
          period: PERIOD,
          groups: [
            { key: 'executive', name: noun('Executive', 'Executives'), size: 2 },
            { key: 'officer', name: noun('Officer', 'Officers'), size: 9 },
          ],
          group: 'executive',
          metrics: METRICS,
          rows: [
            row(RAVI, 'Ravi Kumar', {
              territory: { code: 'IND-W', name: 'Indore West' },
              score: 100,
              rank: 1,
              previousRank: 3,
              you: false,
            }),
            row(ASHA, 'Asha Rao', { score: null, rank: null, previousRank: null, you: true }),
          ],
        },
      },
      {},
      ['leaderboard.view'],
    );
    renderAt('/leaderboard', client);
    const table = await screen.findByRole('table', { name: 'Leaderboard for Executives' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByLabelText('Rank 1')).toBeVisible();
    expect(rows[0]).toHaveTextContent('Indore West');
    expect(rows[0]).toHaveTextContent('50%');
    expect(within(rows[0]!).getByText('Up 2').closest('.ks-badge')).toHaveClass('success');
    expect(rows[1]).toHaveTextContent('Asha Rao (you)');
    expect(rows[1]).toHaveTextContent('Not ranked');
    expect(rows[1]).toHaveTextContent('Nothing to compare yet');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/Indicative ranking/)).toBeVisible();

    const mix = screen.getByRole('img', { name: 'The score’s weights: Calls 50, Sales 50' });
    expect(mix).toBeVisible();

    const groups = screen.getByRole('group', { name: 'Group' });
    expect(within(groups).getByRole('button', { name: /Executives · 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.setup().click(within(groups).getByRole('button', { name: /Officers · 9/ }));
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringMatching(/^\/v1\/leaderboard\?period=\d{4}-\d{2}&group=officer$/),
      expect.anything(),
    );
  });

  it('holds the leaderboard and the manager’s team as two tabs of one page (decision D104)', async () => {
    const client = fakeClient(
      {
        '/v1/leaderboard': {
          period: PERIOD,
          groups: [{ key: 'executive', name: noun('Executive', 'Executives'), size: 1 }],
          group: 'executive',
          metrics: METRICS,
          rows: [
            {
              user: person(RAVI, 'Ravi Kumar'),
              territory: null,
              figures: {},
              score: 100,
              rank: 1,
              previousRank: null,
              you: false,
            },
          ],
        },
        '/v1/performance/team': {
          period: PERIOD,
          metrics: METRICS,
          rows: [
            {
              user: person(ASHA, 'Asha Rao'),
              designation: 'executive',
              territory: null,
              figures: MONTH.figures,
              score: 50,
              rank: 2,
              previousRank: null,
            },
          ],
          totals: {},
        },
      },
      {},
      ['performance.view_team', 'leaderboard.view'],
    );
    renderAt('/performance', client);
    const tabs = await screen.findByRole('tablist', { name: 'Performance views' });
    expect(within(tabs).getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('table', { name: 'Leaderboard for Executives' })).toBeVisible();
    await userEvent.setup().click(within(tabs).getByRole('tab', { name: 'My team' }));
    expect(
      await screen.findByRole('table', {
        name: 'The month for each person, by metric, with score and rank',
      }),
    ).toBeVisible();
    // One rail entry for both.
    const rail = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(rail).getAllByRole('link', { name: /Performance|Leaderboard/ })).toHaveLength(1);
  });
});
