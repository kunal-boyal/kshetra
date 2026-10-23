import type { TenantPermission } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const EVERYTHING: TenantPermission[] = [
  'settings.manage',
  'terminology.manage',
  'role.manage',
  'designation.manage',
  'territory.manage',
  'form.manage',
  'metric.manage',
  'catalogue.manage',
];
const FILE = { key: 'generic', version: 3, forms: [] };
const PLAN = {
  changes: [
    { section: 'accountTypes', key: 'partner', change: 'add' },
    { section: 'geographyLevels', key: 'region', change: 'update' },
    { section: 'roles', key: 'tenant_admin', change: 'kept' },
    { section: 'forms', key: 'meeting', change: 'same' },
  ],
  issues: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('configuration export and import (M2)', () => {
  it('downloads the configuration as a JSON file', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:configuration');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const client = fakeClient({ '/v1/configuration/export': FILE }, {}, ['settings.manage']);
    renderAt('/settings/configuration', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download the configuration' }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(JSON.parse(await (created.mock.calls[0]![0] as Blob).text())).toEqual(FILE);
    // Without every permission over the configuration, there is nothing to import.
    expect(screen.queryByRole('region', { name: 'Import' })).toBeNull();
  });

  it('shows what a file would change, then imports it once confirmed', async () => {
    const client = fakeClient(
      {},
      {
        'POST /v1/configuration/import/preview': () => PLAN,
        'POST /v1/configuration/import': () => PLAN,
      },
      EVERYTHING,
    );
    renderAt('/settings/configuration', client);
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Import' });
    const file = new File([JSON.stringify(FILE)], 'staging.json', { type: 'application/json' });
    await user.upload(within(section).getByLabelText('Choose a file'), file);

    expect(
      await within(section).findByText(
        'staging.json: 1 to add, 1 to change, 1 kept as they are, 1 the same.',
      ),
    ).toBeVisible();
    const table = within(section).getByRole('table', { name: 'What the import does' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).queryByText('meeting')).toBeNull();
    await user.click(within(section).getByRole('checkbox', { name: /entries that are the same/ }));
    expect(within(table).getByText('meeting')).toBeVisible();

    await user.click(within(section).getByRole('button', { name: 'Import the file' }));
    const confirm = within(section).getByRole('group', { name: 'Add 1 and change 1?' });
    await user.click(within(confirm).getByRole('button', { name: 'Import the file' }));
    expect(await within(section).findByText('Imported: 1 added and 1 changed.')).toBeVisible();
    expect(writesOf(client).map(([method, path, , options]) => [method, path, options])).toEqual([
      [
        'POST',
        '/v1/configuration/import/preview',
        expect.objectContaining({ body: { template: FILE } }),
      ],
      ['POST', '/v1/configuration/import', expect.objectContaining({ body: { template: FILE } })],
    ]);
  });

  it('lists the problems in a file, and offers nothing to import', async () => {
    const client = fakeClient(
      {},
      {
        'POST /v1/configuration/import/preview': () => ({
          changes: [],
          issues: [
            {
              path: 'forms[0].fields',
              issue: '`note` was a short_text field, and a key keeps its type',
            },
          ],
        }),
      },
      EVERYTHING,
    );
    renderAt('/settings/configuration', client);
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Import' });
    await user.upload(
      within(section).getByLabelText('Choose a file'),
      new File([JSON.stringify(FILE)], 'broken.json', { type: 'application/json' }),
    );
    expect(await within(section).findByText('forms[0].fields')).toBeVisible();
    expect(within(section).queryByRole('button', { name: 'Import the file' })).toBeNull();

    await user.upload(
      within(section).getByLabelText('Choose a file'),
      new File(['not json'], 'notes.txt', { type: 'application/json' }),
    );
    expect(await within(section).findByText(/isn’t a configuration file/)).toBeVisible();
  });
});
