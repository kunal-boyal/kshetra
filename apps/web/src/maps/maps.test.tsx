import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fakeClient, noun, renderAt } from '../test-support';

const ASHA = '01a10000-0000-7000-8000-000000000004';
const RAVI = '01a10000-0000-7000-8000-000000000005';
const SHOP = '01a10000-0000-7000-8000-000000000080';
const SHIFT = '01a10000-0000-7000-8000-0000000000c1';
const READ_AT = '2026-10-21T06:00:00.000Z';
const minutesAgo = (minutes: number) =>
  new Date(Date.parse(READ_AT) - minutes * 60_000).toISOString();
const person = (id: string, name: string) => ({ id, code: `SUN-${id.slice(-3)}`, name });

const LIVE = {
  readAt: READ_AT,
  people: [
    {
      user: person(ASHA, 'Asha Rao'),
      shiftId: SHIFT,
      onDutySince: minutesAgo(120),
      paused: false,
      position: { lat: 28.6315, lng: 77.2167 },
      accuracy: 12,
      battery: 80,
      seenAt: minutesAgo(3),
      visit: {
        account: { id: SHOP, code: 'C-80', name: 'Sharma Stores' },
        checkInAt: minutesAgo(10),
      },
    },
    {
      user: person(RAVI, 'Ravi Kumar'),
      shiftId: '01a10000-0000-7000-8000-0000000000c2',
      onDutySince: minutesAgo(90),
      paused: true,
      position: { lat: 28.64, lng: 77.22 },
      accuracy: 20,
      battery: null,
      seenAt: minutesAgo(40),
      visit: null,
    },
  ],
};

const TRAIL = {
  user: person(ASHA, 'Asha Rao'),
  date: '2026-10-21',
  shifts: [
    {
      id: SHIFT,
      startedAt: '2026-10-21T03:30:00.000Z',
      endedAt: null,
      source: 'points',
      points: [
        { lat: 28.6315, lng: 77.2167, at: '2026-10-21T03:35:00.000Z' },
        { lat: 28.6355, lng: 77.2167, at: '2026-10-21T03:40:00.000Z' },
      ],
      distanceM: 2400,
      gaps: [{ from: '2026-10-21T03:40:00.000Z', to: '2026-10-21T04:00:00.000Z' }],
      pauses: [],
    },
  ],
  visits: [
    {
      id: '01a10000-0000-7000-8000-0000000000e1',
      account: { id: SHOP, code: 'C-80', name: 'Sharma Stores' },
      location: { lat: 28.6315, lng: 77.2167 },
      checkInAt: '2026-10-21T04:05:00.000Z',
      checkOutAt: null,
      geofence: 'outside',
      distanceM: 640,
    },
  ],
};

const MAPS = ['live_map.view', 'trail.view', 'account.view'] as const;

describe('the live map (M17)', () => {
  it('lists who is on duty, flags a stale position, and offers each day’s replay', async () => {
    renderAt('/live-map', fakeClient({ '/v1/live': LIVE }, {}, MAPS));
    const list = await screen.findByRole('region', { name: 'People on duty' });
    expect(await within(list).findByRole('heading', { name: '2 on duty' })).toBeVisible();
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Asha Rao');
    expect(items[0]).toHaveTextContent('Seen 3 minutes ago');
    expect(items[0]).toHaveTextContent('At Sharma Stores');
    expect(items[0]).not.toHaveTextContent('Not seen for 15 minutes');
    expect(items[1]).toHaveTextContent('Not seen for 15 minutes');
    expect(items[1]).toHaveTextContent('Paused');
    expect(within(items[0]!).getByRole('link', { name: 'Day replay' })).toHaveAttribute(
      'href',
      `/people/${ASHA}/replay`,
    );
    // No Maps key in tests: the map says so, and the list still works.
    expect(screen.getByRole('img', { name: 'Map of the people on duty' })).toHaveTextContent(
      'Maps need a Google Maps key',
    );
  });
});

describe('the accounts layer (M17)', () => {
  it('colours accounts by type, filled once visited, with a key', async () => {
    const pin = (id: string, name: string, type: string, visited: boolean) => ({
      id,
      code: `C-${id.slice(-2)}`,
      name,
      type,
      location: { lat: 28.6315, lng: 77.2167 },
      visited,
    });
    const client = fakeClient(
      {
        '/v1/live': LIVE,
        '/v1/account-pins': {
          period: '2026-10',
          items: [
            pin(SHOP, 'Sharma Stores', 'retailer', true),
            pin('01a10000-0000-7000-8000-000000000081', 'Ram Lal', 'farmer', false),
          ],
          truncated: false,
        },
      },
      {},
      MAPS,
      {
        accountTypes: [
          { key: 'distributor', name: noun('Distributor', 'Distributors'), active: true },
          { key: 'retailer', name: noun('Retailer', 'Retailers'), active: true },
          { key: 'farmer', name: noun('Farmer', 'Farmers'), active: true },
        ],
      },
    );
    renderAt('/live-map', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /Show/ }));
    const key = await screen.findByRole('group', { name: 'Key to the map' });
    // Only the types on the map, each in its own series colour: the type's place in the list.
    const types = within(key).getAllByRole('listitem');
    expect(types.map((item) => item.textContent)).toEqual(['Retailers', 'Farmers']);
    expect(types[0]!.querySelector('.ks-map-dot')).toHaveClass('series-2');
    expect(types[1]!.querySelector('.ks-map-dot')).toHaveClass('series-3');
    expect(key).toHaveTextContent('Visited this month');
    expect(key).toHaveTextContent('Not visited yet');
  });
});

describe('the day replay (M17)', () => {
  it('sums the day and lists gaps and visits with their geofence results', async () => {
    renderAt(`/people/${ASHA}/replay`, fakeClient({ '/v1/trails': TRAIL }, {}, MAPS));
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao’s day' })).toBeVisible();
    expect(screen.getByText('1 shift, 2.4 km, 1 visits.')).toBeVisible();
    expect(screen.getByText(/No location from/)).toBeVisible();
    const visits = screen.getByRole('region', { name: 'Visits' });
    expect(visits).toHaveTextContent('Sharma Stores');
    expect(visits).toHaveTextContent('Outside the geofence');
    expect(screen.getByRole('slider', { name: /Where they were at/ })).toBeVisible();
  });

  it('says when nothing happened that day', async () => {
    renderAt(
      `/people/${ASHA}/replay`,
      fakeClient({ '/v1/trails': { ...TRAIL, shifts: [], visits: [] } }, {}, MAPS),
    );
    expect(await screen.findByText('Nothing that day')).toBeVisible();
  });
});

describe('visit density (M17)', () => {
  it('summarises the month and lists the busiest places', async () => {
    renderAt(
      '/density',
      fakeClient(
        {
          '/v1/density': {
            period: '2026-10',
            cell: 0.01,
            visits: 5,
            cells: [
              { lat: 28.631, lng: 77.216, visits: 4 },
              { lat: 28.701, lng: 77.1, visits: 1 },
            ],
          },
        },
        {},
        MAPS,
      ),
    );
    expect(await screen.findByText('5 visits across 2 places.')).toBeVisible();
    const rows = within(screen.getByRole('table', { name: 'The busiest places this month' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]).toHaveTextContent('28.631, 77.216');
    expect(rows[0]).toHaveTextContent('4');
  });
});
