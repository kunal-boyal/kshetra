import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const NORTH = '01a10000-0000-7000-8000-000000000010';
const SOUTH = '01a10000-0000-7000-8000-000000000011';
const DELHI = '01a10000-0000-7000-8000-000000000012';
const AGRA = '01a10000-0000-7000-8000-000000000013';

const node = (id: string, code: string, name: string, parentId: string | null, active = true) => ({
  id,
  parentId,
  level: parentId ? 2 : 1,
  code,
  name,
  active,
});

const TREE = {
  items: [
    node(DELHI, 'N-DEL', 'Delhi', NORTH),
    node(SOUTH, 'SOUTH', 'South', null),
    node(NORTH, 'NORTH', 'North', null),
    node(AGRA, 'N-AGR', 'Agra', NORTH, false),
  ],
  levels: [
    { level: 1, key: 'region', name: noun('Region', 'Regions') },
    { level: 2, key: 'area', name: noun('Area', 'Areas') },
  ],
};

const MANAGE = ['territory.manage', 'import.run'] as const;
const body = (client: ReturnType<typeof fakeClient>, index = 0) =>
  (writesOf(client)[index]![3] as { body: unknown }).body;

describe('the territory tree', () => {
  it('shows each territory under its parent, and hides switched-off ones until asked', async () => {
    renderAt('/territories', fakeClient({ '/v1/territories': TREE }, {}, MANAGE));
    const table = await screen.findByRole('table', { name: 'Territories, each under its parent' });
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]!.textContent);
    expect(names()).toEqual(['NorthRegion', 'DelhiArea', 'SouthRegion']);

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Show switched-off territories' }));
    expect(names()).toEqual(['NorthRegion', 'AgraArea', 'DelhiArea', 'SouthRegion']);
    expect(within(table).getByRole('row', { name: /Agra/ })).toHaveTextContent('Off');
  });

  it('adds a territory under a parent, a level down', async () => {
    const client = fakeClient(
      { '/v1/territories': TREE },
      { 'POST /v1/territories': () => node(DELHI, 'S-CHE', 'Chennai', SOUTH) },
      MANAGE,
    );
    renderAt('/territories', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add Area under South' }));
    const form = screen.getByRole('region', { name: 'Add Area under South' });
    expect(form).toHaveTextContent('Level: Area');
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Chennai');
    await user.type(within(form).getByRole('textbox', { name: /Code/ }), 'S-CHE');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Chennai is saved.')).toBeVisible();
    expect(body(client)).toEqual({ code: 'S-CHE', name: 'Chennai', parentId: SOUTH });
  });

  it('moves a territory only under another of the level above, sending only what changed', async () => {
    const client = fakeClient(
      { '/v1/territories': TREE },
      { [`PATCH /v1/territories/${DELHI}`]: () => node(DELHI, 'N-DEL', 'Delhi', SOUTH) },
      MANAGE,
    );
    renderAt('/territories', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Delhi' }));
    const form = screen.getByRole('region', { name: 'Edit Delhi' });
    const parent = within(form).getByRole('combobox', { name: 'Parent' });
    expect(
      within(parent)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['North (NORTH)', 'South (SOUTH)']);
    await user.selectOptions(parent, SOUTH);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body(client)).toEqual({ parentId: SOUTH }));
  });

  it('says why a territory cannot be switched off', async () => {
    const client = fakeClient(
      { '/v1/territories': TREE },
      {
        [`PATCH /v1/territories/${NORTH}`]: () => {
          throw new ApiError(409, 'CONFLICT', 'Switch off the territories under it first.', [
            { path: 'active', issue: 'Territories under it are still on' },
          ]);
        },
      },
      MANAGE,
    );
    renderAt('/territories', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Switch off North' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Territories under it are still on');
    expect(body(client)).toEqual({ active: false });
  });

  it('only shows the tree to someone who may not change it', async () => {
    renderAt('/territories', fakeClient({ '/v1/territories': TREE }, {}, []));
    await screen.findByRole('table', { name: 'Territories, each under its parent' });
    expect(screen.queryByRole('button', { name: /^(Edit|Add|Switch)/ })).not.toBeInTheDocument();
  });
});
