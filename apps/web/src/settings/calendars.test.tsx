import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { todayIn } from '@thelamp/shared';
import { fakeClient, renderAt, writesOf } from '../test-support';

const YEAR = todayIn('Asia/Kolkata').slice(0, 4);

const DIWALI = { date: `${YEAR}-11-08`, name: 'Diwali', optional: false };
const calendars = (holidays: unknown[]) => ({
  year: Number(YEAR),
  items: [
    {
      key: 'standard',
      name: { en: 'Standard', hi: 'सामान्य' },
      weeklyOffs: [7],
      default: true,
      holidays,
    },
  ],
});

describe('holiday calendars (M13)', () => {
  it('shows each calendar’s weekly offs and holidays, and adds one', async () => {
    const client = fakeClient(
      { [`/v1/calendars?year=${YEAR}`]: calendars([DIWALI]) },
      {
        [`PUT /v1/calendars/standard/holidays/${YEAR}-08-15`]: ({ body }) =>
          calendars([{ date: `${YEAR}-08-15`, ...(body as object) }, DIWALI]),
      },
      ['calendar.manage'],
      { settings: { timezone: 'Asia/Kolkata' } },
    );
    renderAt('/settings/calendars', client);
    const card = await screen.findByRole('region', { name: /Standard/ });
    expect(within(card).getByText('Default')).toBeVisible();
    expect(within(card).getByText('Weekly offs: Sunday')).toBeVisible();
    const table = within(card).getByRole('table', { name: `Holidays in ${YEAR}` });
    expect(within(table).getByRole('row', { name: /Diwali/ })).toBeVisible();

    const user = userEvent.setup();
    await user.type(within(card).getByLabelText(/^Date/), `${YEAR}-08-15`);
    await user.type(within(card).getByRole('textbox', { name: /^Holiday/ }), 'Independence Day');
    await user.click(within(card).getByRole('button', { name: 'Add the holiday' }));
    expect(await within(card).findByText('Independence Day')).toBeVisible();
    expect(
      writesOf(client).map(([method, path, , options]) => [method, path, options?.body]),
    ).toEqual([
      [
        'PUT',
        `/v1/calendars/standard/holidays/${YEAR}-08-15`,
        { name: 'Independence Day', optional: false, active: true },
      ],
    ]);
  });

  it('asks before taking a holiday off', async () => {
    const client = fakeClient(
      { [`/v1/calendars?year=${YEAR}`]: calendars([DIWALI]) },
      { [`PUT /v1/calendars/standard/holidays/${YEAR}-11-08`]: () => calendars([]) },
      ['calendar.manage'],
    );
    renderAt('/settings/calendars', client);
    const card = await screen.findByRole('region', { name: /Standard/ });
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Take off: Diwali' }));
    const ask = within(card).getByRole('group', { name: /Take Diwali on .* off this calendar\?/ });
    expect(writesOf(client)).toEqual([]);
    await user.click(within(ask).getByRole('button', { name: 'Take off' }));
    expect(await within(card).findByText('No holidays this year')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { name: 'Diwali', optional: false, active: false },
    });
  });

  it('only lists holidays for those who can’t manage them', async () => {
    renderAt(
      '/settings/calendars',
      fakeClient({ [`/v1/calendars?year=${YEAR}`]: calendars([DIWALI]) }),
    );
    const card = await screen.findByRole('region', { name: /Standard/ });
    expect(within(card).queryByRole('button', { name: /Take off/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Add the holiday' })).toBeNull();
  });
});
