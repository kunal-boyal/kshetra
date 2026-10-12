import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderAt, writesOf } from '../test-support';

const JOB = '01a10000-0000-7000-8000-000000000070';
const EARLIER = '01a10000-0000-7000-8000-000000000071';
const PERMISSIONS = ['import.run', 'user.manage', 'territory.manage'] as const;

const FIELDS = [
  { key: 'code', required: true },
  { key: 'name', required: true },
  { key: 'mobile', required: false },
  { key: 'reports_to', required: false },
  { key: 'custom.hq', required: false, label: { en: 'HQ', hi: 'मुख्यालय' } },
];

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    target: 'users',
    fileName: 'people.csv',
    status: 'mapping',
    sheets: [],
    sheet: null,
    headerRow: 1,
    headers: ['Emp code', 'Full name', 'Phone', 'Head office'],
    mapping: { 'Emp code': 'code', 'Full name': 'name', Phone: 'mobile', 'Head office': null },
    fields: FIELDS,
    totalRows: 2,
    errorRows: null,
    errors: [],
    preview: [],
    created: null,
    updated: null,
    createdBy: ADMIN,
    createdAt: '2026-10-12T05:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const EARLIER_JOB = job({
  id: EARLIER,
  fileName: 'october.xlsx',
  status: 'committed',
  totalRows: 40,
  created: 38,
  updated: 2,
});

const PREVIEW = [
  { row: 2, values: { code: 'S-1', name: 'Sita Field', mobile: '9000000001' }, problems: [] },
  {
    row: 3,
    values: { code: 'S-1', name: 'Second Sita', mobile: '' },
    problems: ['This code appears more than once, in rows 2, 3'],
  },
];

describe('the imports page', () => {
  it('lists earlier imports, and uploads a file as the body to start a new one', async () => {
    const client = fakeClient(
      {
        '/v1/imports': { items: [EARLIER_JOB], nextCursor: null },
        [`/v1/imports/${JOB}`]: job(),
      },
      { 'POST /v1/imports': () => job({ status: 'reading', headers: [], mapping: {} }) },
      PERMISSIONS,
    );
    renderAt('/imports', client);
    const table = await screen.findByRole('table', { name: 'Imports, newest first' });
    expect(within(table).getByRole('row', { name: /october\.xlsx/ })).toHaveTextContent(
      '38 added, 2 changed',
    );

    const user = userEvent.setup();
    // Asking for nothing says what is missing, and sends nothing.
    await user.click(screen.getByRole('button', { name: 'Upload and read' }));
    expect(screen.getByText('Choose a file to import.')).toBeInTheDocument();
    expect(writesOf(client)).toEqual([]);

    expect(screen.getByRole('combobox', { name: 'What to import' })).toHaveValue('users');
    const file = new File(['Emp code,Full name\nS-1,Sita'], 'people.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Choose a file'), file);
    await user.click(screen.getByRole('button', { name: 'Upload and read' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'people.csv' })).toBeVisible();
    expect(writesOf(client)).toEqual([
      [
        'POST',
        '/v1/imports?target=users&fileName=people.csv',
        expect.anything(),
        { file: { data: file, type: 'text/csv' }, idempotencyKey: expect.any(String) },
      ],
    ]);
  });

  it('offers only what the person may change', async () => {
    const client = fakeClient({ '/v1/imports': { items: [], nextCursor: null } }, {}, [
      'import.run',
      'territory.manage',
    ]);
    renderAt('/imports', client);
    const what = await screen.findByRole('combobox', { name: 'What to import' });
    expect(
      within(what)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Territories']);
    expect(screen.getByText('No imports yet')).toBeInTheDocument();
  });
});

describe('one import', () => {
  it('matches columns to fields, refuses a field chosen twice, and saves the choices by name', async () => {
    const client = fakeClient(
      { [`/v1/imports/${JOB}`]: job() },
      { [`PUT /v1/imports/${JOB}/mapping`]: () => job({ status: 'validating' }) },
      PERMISSIONS,
    );
    renderAt(`/imports/${JOB}`, client);
    const columns = await screen.findByRole('region', { name: 'Columns' });
    expect(within(columns).getByRole('combobox', { name: 'Emp code' })).toHaveValue('code');
    const office = within(columns).getByRole('combobox', { name: 'Head office' });
    expect(office).toHaveValue('');

    const user = userEvent.setup();
    await user.selectOptions(office, 'name');
    expect(
      within(columns).getAllByText('Another column fills this too. Choose each field once.'),
    ).toHaveLength(2);
    expect(within(columns).getByRole('button', { name: 'Check the file' })).toBeDisabled();

    await user.selectOptions(office, 'custom.hq');
    await user.type(
      within(columns).getByRole('textbox', { name: 'Save these choices as' }),
      'Staff',
    );
    await user.click(within(columns).getByRole('button', { name: 'Check the file' }));
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'PUT',
          `/v1/imports/${JOB}/mapping`,
          expect.anything(),
          {
            body: {
              mapping: {
                'Emp code': 'code',
                'Full name': 'name',
                Phone: 'mobile',
                'Head office': 'custom.hq',
              },
              saveAs: 'Staff',
            },
            idempotencyKey: expect.any(String),
          },
        ],
      ]),
    );
    expect(
      await screen.findByText('Checking every row. This page updates by itself.'),
    ).toBeVisible();
  });

  it('shows the problems by row, with nothing to import until the file is right', async () => {
    const client = fakeClient(
      {
        [`/v1/imports/${JOB}`]: job({
          status: 'invalid',
          errorRows: 1,
          errors: [
            { row: 3, field: 'code', issue: 'This code appears more than once, in rows 2, 3' },
          ],
          preview: PREVIEW,
        }),
      },
      {},
      PERMISSIONS,
    );
    renderAt(`/imports/${JOB}`, client);
    const problems = await screen.findByRole('table', { name: 'Problems, by row of the file' });
    expect(within(problems).getByRole('row', { name: /^3 Employee code/ })).toHaveTextContent(
      'appears more than once',
    );
    const preview = screen.getByRole('table', { name: 'The first rows, as they will be imported' });
    expect(within(preview).getByRole('row', { name: /^2 S-1 Sita Field/ })).toHaveTextContent(
      'No problems',
    );
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing has been imported/)).toBeVisible();
  });

  it('imports every row only after asking', async () => {
    const client = fakeClient(
      {
        [`/v1/imports/${JOB}`]: job({
          status: 'ready',
          errorRows: 0,
          preview: PREVIEW.slice(0, 1),
          totalRows: 1,
        }),
      },
      {
        [`POST /v1/imports/${JOB}/commit`]: () =>
          job({ status: 'committed', created: 1, updated: 0, totalRows: 1 }),
      },
      PERMISSIONS,
    );
    renderAt(`/imports/${JOB}`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Import 1 row' }));
    const question = screen.getByRole('group', { name: 'Import 1 row now?' });
    expect(writesOf(client)).toEqual([]);
    await user.click(within(question).getByRole('button', { name: 'Import 1 row' }));
    expect(await screen.findByText('Imported: 1 added, 0 changed.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open people' })).toHaveAttribute('href', '/people');
    expect(writesOf(client)).toEqual([
      [
        'POST',
        `/v1/imports/${JOB}/commit`,
        expect.anything(),
        { idempotencyKey: expect.any(String) },
      ],
    ]);
  });
});
