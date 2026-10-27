import { SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, noun, renderAt } from '../test-support';

const PERIOD = todayIn(SETTING_DEFAULTS.timezone).slice(0, 7);
const metric = (key: string, one: string, other: string, unit = 'count') => ({
  key,
  name: noun(one, other),
  unit,
  direction: 'higher_is_better',
  targetable: true,
  available: true,
  weight: null,
});
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

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
      metric: metric('order_value', 'Order value', 'Order value', 'currency'),
      figures: { actual: '7000', pending: null, target: '10000', attainment: 0.7 },
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
        territory: { code: 'IND-W', name: 'Indore West' },
        score: 92,
        rank: 1,
        you: false,
      },
      {
        user: { id: '01a10000-0000-7000-8000-000000000001', code: 'SUN-001', name: 'Anita Rao' },
        territory: null,
        score: null,
        rank: null,
        you: true,
      },
    ],
  },
  onDuty: 3,
  onDutyPeople: [
    {
      user: { id: '01a10000-0000-7000-8000-000000000004', name: 'Rahul Verma' },
      place: 'Sharma Stores',
      visits: 3,
      paused: false,
      seenAt: minutesAgo(2),
    },
    {
      user: { id: '01a10000-0000-7000-8000-000000000005', name: 'Pooja Rathore' },
      place: null,
      visits: 0,
      paused: false,
      seenAt: minutesAgo(24),
    },
    {
      user: { id: '01a10000-0000-7000-8000-000000000006', name: 'Deepak Chouhan' },
      place: 'Hatod',
      visits: 4,
      paused: true,
      seenAt: minutesAgo(1),
    },
  ],
  onLeaveToday: 1,
  waiting: { reviews: 2, approvals: 3, plans: 0, leave: 1, expenses: 1 },
};

const SELF = {
  ...DASHBOARD,
  view: 'self',
  people: 1,
  onDuty: null,
  onDutyPeople: null,
  onLeaveToday: null,
  waiting: { reviews: null, approvals: null, plans: null, leave: null, expenses: null },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the home dashboard (M18, decision D104)', () => {
  it('greets the viewer for the hour on the tenant’s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 09:00 in India.
    vi.setSystemTime(new Date('2026-10-27T03:30:00Z'));
    renderAt('/', fakeClient({ '/v1/dashboard': SELF }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Good morning, Anita' }),
    ).toBeVisible();
    expect(
      await screen.findByText(/Tuesday, 27 October · your own figures · updated/),
    ).toBeVisible();
    cleanup();
    // 19:00 in India.
    vi.setSystemTime(new Date('2026-10-27T13:30:00Z'));
    renderAt('/', fakeClient({ '/v1/dashboard': SELF }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Good evening, Anita' }),
    ).toBeVisible();
  });

  it('shows who is on duty first, then each metric as a tile that leads to performance', async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': DASHBOARD }, {}, ['live_map.view']));
    const figures = await screen.findByRole('region', { name: 'Your team of 4 this month' });
    const links = within(figures).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/live-map');
    expect(links[0]).toHaveTextContent('On duty now3of 4 people1 on leave');
    expect(links[1]).toHaveAttribute('href', '/performance');
    expect(links[1]).toHaveTextContent('Visits');
    expect(links[2]).toHaveTextContent('Order value');
  });

  it('lists the people on duty with how lately each was seen', async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': DASHBOARD }, {}, ['live_map.view']));
    const table = await screen.findByRole('table', { name: 'On duty now · 3 of 4' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'RVRahul VermaSharma Stores32 min ago',
      'PRPooja Rathore—024 min ago',
      'DCDeepak ChouhanHatod4Paused',
    ]);
    const tone = (row: HTMLElement) =>
      within(row)
        .getByText(/ago|Paused/)
        .closest('.ks-badge');
    expect(tone(rows[0]!)).toHaveClass('success');
    expect(tone(rows[1]!)).toHaveClass('pending');
    expect(tone(rows[2]!)).toHaveClass('neutral');
    const card = screen.getByRole('region', { name: 'On duty now · 3 of 4' });
    expect(within(card).getByRole('link', { name: 'Live map' })).toHaveAttribute(
      'href',
      '/live-map',
    );
  });

  it('lists what waits, each with its count, leaving out what has none', async () => {
    renderAt(
      '/',
      fakeClient({ '/v1/dashboard': DASHBOARD }, {}, ['submission.review', 'approval.act']),
    );
    const waiting = await screen.findByRole('list', { name: 'Waiting for you' });
    const items = within(waiting).getAllByRole('link');
    expect(items.map((item) => item.textContent)).toEqual([
      'Forms to review2',
      'Leave and attendance1',
      'Expense claims1',
      'Other requests1',
    ]);
    expect(items[0]).toHaveAttribute('href', '/review');
    expect(items[1]).toHaveAttribute('href', '/approvals?type=leave');
  });

  it('shows the top of the leaderboard with territories, the viewer marked', async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': DASHBOARD }));
    const board = await screen.findByRole('list', { name: 'Leaderboard · Executives' });
    const [first, mine] = within(board).getAllByRole('listitem');
    expect(within(first!).getByLabelText('Rank 1')).toHaveTextContent('1');
    expect(first).toHaveTextContent('Indore West');
    expect(within(mine!).getByText('Anita Rao (you)').closest('.ks-item')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(mine!).getByLabelText('Not ranked')).toBeVisible();
    expect(screen.getByText(/Indicative/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'href',
      '/performance?view=leaderboard',
    );
  });

  it('keeps the charts beside their numbers', async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': DASHBOARD }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Visits by day' })).toBeVisible();
    // The charts load in their own chunk, which takes a while the first time in a busy run.
    const loading = { timeout: 10_000 };
    await screen.findByRole(
      'img',
      { name: 'Visits each day this month, approved and waiting for review' },
      loading,
    );
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
  });

  it('shows a field person their own month, without the team’s cards', async () => {
    renderAt('/', fakeClient({ '/v1/dashboard': SELF }));
    expect(await screen.findByRole('region', { name: 'Your month' })).toBeVisible();
    expect(screen.queryByText('On duty now')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull();
  });

  it('says when a tenant has no figures yet', async () => {
    renderAt(
      '/',
      fakeClient({
        '/v1/dashboard': { ...SELF, tiles: [], trend: [], mix: [], leaderboard: null },
      }),
    );
    expect(await screen.findByText('No figures yet')).toBeVisible();
    expect(screen.getByText('No forms filled this month.')).toBeVisible();
  });
});
