import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt } from '../test-support';

const PERIOD = todayIn(SETTING_DEFAULTS.timezone).slice(0, 7);
const metric = (key: string, one: string, other: string) => ({
  key,
  name: noun(one, other),
  unit: 'count',
  direction: 'higher_is_better',
  targetable: true,
  available: true,
  weight: null,
});

const DASHBOARD = {
  period: PERIOD,
  view: 'team',
  people: 4,
  tiles: [
    {
      metric: metric('visits', 'Visit', 'Visits'),
      figures: { actual: '42', pending: '3', target: '60', attainment: 0.7 },
    },
    {
      metric: metric('orders', 'Order', 'Orders'),
      figures: { actual: '7', pending: null, target: '10', attainment: 0.7 },
    },
  ],
  trend: [
    {
      key: 'visits',
      days: [
        { date: `${PERIOD}-01`, actual: 5, pending: 1 },
        { date: `${PERIOD}-02`, actual: 8, pending: null },
      ],
    },
  ],
  mix: [
    {
      form: { key: 'shop_visit', name: noun('Shop visit', 'Shop visits') },
      approved: 30,
      pending: 3,
      rejected: 1,
    },
  ],
  leaderboard: {
    group: { key: 'executive', name: noun('Executive', 'Executives') },
    rows: [
      {
        user: { id: '01a10000-0000-7000-8000-000000000004', code: 'SUN-004', name: 'Rahul Verma' },
        score: 92,
        rank: 1,
        you: false,
      },
    ],
  },
  onDuty: 3,
  waiting: { reviews: 2, approvals: null },
};

describe('the home dashboard (M18)', () => {
  it("shows the team's tiles, what waits, the charts' numbers and the leaderboard", async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': DASHBOARD }, {}, ['submission.review']));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your team of 4 this month' }),
    ).toBeVisible();
    expect(screen.getByText('Team totals')).toBeVisible();
    expect(screen.getByText('Visits')).toBeVisible();
    const waiting = screen.getByRole('list', { name: 'Waiting for you' });
    expect(within(waiting).getByRole('link', { name: /2 forms to review/ })).toHaveAttribute(
      'href',
      '/review',
    );
    expect(within(waiting).getByRole('link', { name: /3 on duty now/ })).toBeVisible();
    expect(within(waiting).queryByText(/requests to decide/)).toBeNull();
    // The charts load in their own chunk, which takes a while the first time in a busy run.
    const loading = { timeout: 10_000 };
    expect(
      await screen.findByRole(
        'img',
        { name: 'Visits each day this month, approved and waiting for review' },
        loading,
      ),
    ).toBeInTheDocument();
    await screen.findByRole(
      'img',
      { name: 'Forms filled this month, by form and review status' },
      loading,
    );

    const user = userEvent.setup();
    const [trendNumbers] = screen.getAllByText('Show the numbers');
    await user.click(trendNumbers!);
    const trend = screen.getByRole('table', { name: /Visits each day/ });
    expect(within(trend).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('table', { name: /Forms filled this month/ })).toHaveTextContent(
      'Shop visits',
    );
    expect(screen.getByText(/Indicative/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'See the whole Executives leaderboard' }),
    ).toBeVisible();
  });

  it('says when a tenant has no figures yet', async () => {
    renderAt(
      '/',
      fakeClient({
        '/v1/dashboard': {
          ...DASHBOARD,
          view: 'self',
          people: 1,
          tiles: [],
          trend: [],
          mix: [],
          leaderboard: null,
          onDuty: null,
          waiting: { reviews: null, approvals: null },
        },
      }),
    );
    expect(await screen.findByText('No figures yet')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Your month' })).toBeVisible();
    expect(screen.getByText('No forms filled this month.')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Waiting for you' })).toBeNull();
  });
});
