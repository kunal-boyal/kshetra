import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@thelamp/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../browser';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const ID = '01a10000-0000-7000-8000-0000000000f1';
const WHOLESALE = '01a10000-0000-7000-8000-0000000000f2';
const SETTINGS = {
  accountType: null,
  territoryField: null,
  defaultTerritory: null,
  itemPriceList: null,
  priceBooks: [],
  units: {},
  invoiceDays: 180,
  dailyCalls: 1000,
  read: { customers: true, items: true, invoices: true, payments: true },
  pushOrders: false,
  taxRateField: null,
  defaultTaxRate: null,
  debtorGroups: ['Sundry Debtors'],
  groupTerritories: {},
  salesTypes: ['Sales'],
  receiptTypes: ['Receipt'],
  orderType: 'Sales Order',
};
const connection = (patch: object = {}) => ({
  id: ID,
  provider: 'zoho_books',
  status: 'connected',
  region: 'in',
  organization: { id: '60001', name: 'Sunrise Traders Pvt Ltd' },
  organizations: [],
  settings: SETTINGS,
  connectedAt: '2026-11-02T05:00:00.000Z',
  connectedBy: { id: '01a10000-0000-7000-8000-000000000001', name: 'Kavita Deshmukh' },
  lastRunAt: '2026-11-02T06:00:00.000Z',
  ...patch,
});
const RUN = {
  id: '01a10000-0000-7000-8000-0000000000f3',
  kind: 'pull',
  status: 'partial',
  stoppedBy: null,
  startedAt: '2026-11-02T06:00:00.000Z',
  finishedAt: '2026-11-02T06:01:00.000Z',
  counts: { account: { read: 4, created: 2, updated: 0, unchanged: 0, skipped: 2 } },
  problems: [
    {
      entity: 'account',
      externalId: '460000000026049',
      label: 'No Number Traders',
      issue: 'no_customer_number',
      field: null,
      detail: null,
    },
  ],
  calls: 9,
};
const BUNDLE = {
  accountTypes: [
    {
      key: 'distributor',
      name: {
        en: { one: 'Distributor', other: 'Distributors' },
        hi: { one: 'डिस्ट्रीब्यूटर', other: 'डिस्ट्रीब्यूटर' },
      },
    },
  ],
  catalogue: {
    units: [
      {
        key: 'piece',
        base: true,
        name: { en: { one: 'Piece', other: 'Pieces' }, hi: { one: 'पीस', other: 'पीस' } },
      },
    ],
    measureTypes: [],
  },
};

function erpClient(current: object | null, configured = true) {
  let held = current;
  return fakeClient(
    {
      '/v1/erp-connections': () => ({
        providers: [{ provider: 'zoho_books', configured, connection: held }],
      }),
      [`/v1/erp-connections/${ID}/runs`]: { items: [RUN] },
      '/v1/territories': {
        items: [{ id: 't1', parentId: null, level: 0, code: 'NSK', name: 'Nashik', active: true }],
      },
      '/v1/price-lists': { items: [{ id: WHOLESALE, name: 'Wholesale' }] },
    },
    {
      'POST /v1/erp-connections/zoho/start': () => ({
        authorizeUrl: 'https://accounts.zoho.in/oauth/v2/auth?state=s1',
      }),
      'POST /v1/erp-connections/zoho/complete': () => {
        held = connection();
        return held;
      },
      [`PUT /v1/erp-connections/${ID}/settings`]: ({ body }: RequestOptions) => {
        held = connection({ settings: { ...SETTINGS, ...(body as object) } });
        return held;
      },
      [`PUT /v1/erp-connections/${ID}/organization`]: () => {
        held = connection();
        return held;
      },
      [`POST /v1/erp-connections/${ID}/runs`]: () => ({ ...RUN, status: 'running' }),
      [`POST /v1/erp-connections/${ID}/disconnect`]: () => {
        held = connection({ status: 'disconnected' });
        return held;
      },
    },
    ['erp.manage'],
    BUNDLE,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Settings › ERP (D129)', () => {
  it('says when this server isn’t set up for Zoho', async () => {
    renderAt('/settings/erp', erpClient(null, false));
    expect(await screen.findByText(/isn’t set up for Zoho Books yet/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect Zoho Books' })).toBeNull();
  });

  it('sends the browser to Zoho in the chosen region', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {});
    const client = erpClient(null);
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Connect Zoho Books' });
    await user.selectOptions(within(form).getByRole('combobox', { name: /data centre/ }), 'eu');
    await user.click(within(form).getByRole('button', { name: 'Connect Zoho Books' }));
    await waitFor(() =>
      expect(go).toHaveBeenCalledWith('https://accounts.zoho.in/oauth/v2/auth?state=s1'),
    );
    expect(writesOf(client)[0]![3]).toMatchObject({ body: { region: 'eu' } });
  });

  it('finishes connecting once with what Zoho sent back, then shows the connection', async () => {
    const client = erpClient(null);
    renderAt(
      '/settings/erp/zoho?code=1000.abc&state=s1&location=in&accounts-server=https%3A%2F%2Faccounts.zoho.in',
      client,
    );
    expect(await screen.findByText('Sunrise Traders Pvt Ltd')).toBeVisible();
    expect(writesOf(client)).toHaveLength(1);
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { code: '1000.abc', state: 's1', accountsServer: 'https://accounts.zoho.in' },
    });
  });

  it('says so when Zoho gave no access, and sends nothing', async () => {
    const client = erpClient(null);
    renderAt('/settings/erp/zoho?error=access_denied', client);
    expect(
      await screen.findByText('Zoho didn’t give access. Nothing was connected.'),
    ).toBeVisible();
    expect(writesOf(client)).toHaveLength(0);
  });

  it('asks for the organisation when Zoho holds several', async () => {
    const client = erpClient(
      connection({
        status: 'choosing',
        organization: null,
        organizations: [
          { id: '60001', name: 'Sunrise Traders Pvt Ltd' },
          { id: '60002', name: 'Sunrise Exports' },
        ],
      }),
    );
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Organisation to connect' });
    await user.selectOptions(within(form).getByRole('combobox'), '60002');
    await user.click(within(form).getByRole('button', { name: 'Use this organisation' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({ body: { organizationId: '60002' } }),
    );
  });

  it('saves the mappings, syncs now, shows the last run’s problems in words, and disconnects after asking', async () => {
    const client = erpClient(connection());
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'What comes in, and where' });
    await user.selectOptions(
      within(form).getByRole('combobox', { name: /Customers become/ }),
      'distributor',
    );
    await user.selectOptions(
      within(form).getByRole('combobox', { name: /Territory for new/ }),
      'NSK',
    );
    await user.click(within(form).getByRole('button', { name: 'Add a price book' }));
    await user.type(within(form).getByRole('textbox', { name: 'Price book ID in Zoho' }), 'PB1');
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Into the price list' }),
      WHOLESALE,
    );
    await user.click(within(form).getByRole('checkbox', { name: /Send accepted/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Saved.'));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        accountType: 'distributor',
        defaultTerritory: 'NSK',
        priceBooks: [{ pricebookId: 'PB1', priceList: WHOLESALE }],
        invoiceDays: 180,
        pushOrders: true,
      },
    });

    const runs = screen.getByRole('region', { name: 'Runs' });
    expect(within(runs).getByRole('table', { name: 'Runs' })).toHaveTextContent(
      'Done, with problems',
    );
    expect(
      within(runs).getByText(/No Number Traders: it has no customer number in Zoho\./),
    ).toBeVisible();
    await user.click(within(runs).getByRole('button', { name: 'Sync now' }));
    expect(await within(runs).findByRole('status')).toHaveTextContent('Reading Zoho now.');

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = screen.getByRole('group', { name: /Disconnect Zoho Books\?/ });
    expect(writesOf(client).filter(([, path]) => path.endsWith('/disconnect'))).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect Zoho Books' })).toBeVisible(),
    );
  });

  it('asks to connect again when Zoho refused the connection', async () => {
    renderAt('/settings/erp', erpClient(connection({ status: 'needs_reconnect' })));
    expect(await screen.findByText(/no longer accepts this connection/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeVisible();
    expect(screen.queryByRole('form', { name: 'What comes in, and where' })).toBeNull();
  });
});

const SAP_ID = '01a10000-0000-7000-8000-0000000000f9';
const sapConnection = (patch: object = {}) => ({
  ...connection(),
  id: SAP_ID,
  provider: 'sap_b1',
  region: null,
  organization: { id: 'SBODEMOIN', name: 'SBODEMOIN' },
  endpoint: 'https://b1.sunrise.example/b1s/v2',
  companyDb: 'SBODEMOIN',
  username: 'thelamp-connector',
  ...patch,
});

function sapClient(current: object | null) {
  let held = current;
  return fakeClient(
    {
      '/v1/erp-connections': () => ({
        providers: [
          { provider: 'zoho_books', configured: true, connection: null },
          { provider: 'sap_b1', configured: true, connection: held },
        ],
      }),
      [`/v1/erp-connections/${SAP_ID}/runs`]: { items: [] },
      '/v1/territories': { items: [] },
      '/v1/price-lists': { items: [{ id: WHOLESALE, name: 'Wholesale' }] },
    },
    {
      'POST /v1/erp-connections/sap-b1': ({ body }: RequestOptions) => {
        if ((body as { endpoint: string }).endpoint.includes(':50000')) {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'endpoint', issue: 'not_443' },
          ]);
        }
        held = sapConnection();
        return held;
      },
      [`PUT /v1/erp-connections/${SAP_ID}/settings`]: ({ body }: RequestOptions) => {
        held = sapConnection({ settings: { ...SETTINGS, ...(body as object) } });
        return held;
      },
    },
    ['erp.manage'],
    BUNDLE,
  );
}

describe('SAP Business One in Settings › ERP (D129)', () => {
  it('connects with the Service Layer, company, user and password, and explains a wrong port', async () => {
    const client = sapClient(null);
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Connect SAP Business One' });
    await user.type(
      within(form).getByLabelText(/Service Layer address/),
      'https://b1.sunrise.example:50000',
    );
    await user.type(within(form).getByLabelText(/Company database/), 'SBODEMOIN');
    await user.type(within(form).getByLabelText(/SAP user/), 'thelamp-connector');
    await user.type(within(form).getByLabelText(/Password/), 'fictional-password');
    await user.click(within(form).getByRole('button', { name: 'Connect SAP Business One' }));
    expect(await within(form).findByText(/Use HTTPS on port 443/)).toBeVisible();

    const address = within(form).getByLabelText(/Service Layer address/);
    await user.clear(address);
    await user.type(address, 'https://b1.sunrise.example');
    await user.click(within(form).getByRole('button', { name: 'Connect SAP Business One' }));
    expect(await screen.findByText('SBODEMOIN')).toBeVisible();
    expect(writesOf(client)[1]![3]).toMatchObject({
      body: {
        endpoint: 'https://b1.sunrise.example',
        companyDb: 'SBODEMOIN',
        username: 'thelamp-connector',
        password: 'fictional-password',
      },
    });
    expect(screen.queryByText('fictional-password')).toBeNull();
  });

  it('maps SAP’s GST field and default rate, without Zoho’s daily calls', async () => {
    const client = sapClient(sapConnection());
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const sap = await screen.findByRole('region', { name: 'SAP Business One' });
    const form = within(sap).getByRole('form', { name: 'What comes in, and where' });
    expect(within(form).queryByLabelText(/daily calls/)).toBeNull();
    await user.type(within(form).getByLabelText(/SAP field holding the GST rate/), 'U_GST');
    await user.type(within(form).getByLabelText(/GST rate when the field is empty/), '18');
    await user.click(
      within(form).getByRole('checkbox', { name: /Send accepted .* to SAP Business One/ }),
    );
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { taxRateField: 'U_GST', defaultTaxRate: '18', pushOrders: true },
    });
  });
});

const TALLY_ID = '01a10000-0000-7000-8000-0000000000f5';
const FILE_RUN = {
  ...RUN,
  id: '01a10000-0000-7000-8000-0000000000f6',
  kind: 'push',
  status: 'ok',
  counts: { order: { read: 2, created: 2, updated: 0, unchanged: 0, skipped: 0 } },
  problems: [],
  calls: 0,
  file: 'tally-orders-2026-11-02.xml',
  download: true,
};
const tallyConnection = (patch: object = {}) => ({
  ...connection(),
  id: TALLY_ID,
  provider: 'tally',
  region: null,
  organization: { id: 'Sahyadri Agro Inputs', name: 'Sahyadri Agro Inputs' },
  endpoint: null,
  companyDb: null,
  username: null,
  ordersWaiting: 2,
  ...patch,
});

function tallyClient(current: object | null) {
  let held = current;
  return fakeClient(
    {
      '/v1/erp-connections': () => ({
        providers: [
          { provider: 'zoho_books', configured: true, connection: null },
          { provider: 'sap_b1', configured: true, connection: null },
          { provider: 'tally', configured: true, connection: held },
        ],
      }),
      [`/v1/erp-connections/${TALLY_ID}/runs`]: { items: [FILE_RUN] },
      [`/v1/erp-connections/${TALLY_ID}/runs/${FILE_RUN.id}/file`]: {
        url: 'https://media.example/tally-orders.xml?signature=s',
        expiresAt: '2026-11-02T06:05:00.000Z',
      },
      '/v1/territories': {
        items: [{ id: 't1', parentId: null, level: 0, code: 'NSK', name: 'Nashik', active: true }],
      },
      '/v1/price-lists': { items: [{ id: WHOLESALE, name: 'Wholesale' }] },
    },
    {
      'POST /v1/erp-connections/tally': () => {
        held = tallyConnection({ organization: null });
        return held;
      },
      [`POST /v1/erp-connections/${TALLY_ID}/uploads`]: ({ file }: RequestOptions) => {
        if ((file?.data as File | undefined)?.name === 'Other.xml') {
          throw new ApiError(502, 'ERP_REFUSED', 'This file is from another company in Tally.', [
            { path: 'file', issue: 'tally_other_company' },
          ]);
        }
        return { ...RUN, kind: 'upload', status: 'running', file: 'Master.xml', download: false };
      },
      [`POST /v1/erp-connections/${TALLY_ID}/orders-file`]: () => ({
        ...FILE_RUN,
        status: 'running',
        download: false,
      }),
      [`PUT /v1/erp-connections/${TALLY_ID}/settings`]: ({ body }: RequestOptions) => {
        held = tallyConnection({ settings: { ...SETTINGS, ...(body as object) } });
        return held;
      },
    },
    ['erp.manage'],
    BUNDLE,
  );
}

describe('Tally in Settings › ERP (D129, BR-61)', () => {
  it('connects in a click, with nothing to reach', async () => {
    const client = tallyClient(null);
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const tally = await screen.findByRole('region', { name: 'Tally' });
    await user.click(within(tally).getByRole('button', { name: 'Use Tally' }));
    expect(await within(tally).findByText('Named by the first file you upload')).toBeVisible();
    expect(writesOf(client)[0]!.slice(0, 2)).toEqual(['POST', '/v1/erp-connections/tally']);
  });

  it('uploads a file exported from Tally, and says why another company’s is refused', async () => {
    const client = tallyClient(tallyConnection());
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const tally = await screen.findByRole('region', { name: 'Tally' });
    const input = within(tally).getByLabelText('Upload a file from Tally');
    await user.upload(input, new File(['<ENVELOPE/>'], 'Master.xml', { type: 'text/xml' }));
    expect(await within(tally).findByText(/The file is being read/)).toBeVisible();
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe(`/v1/erp-connections/${TALLY_ID}/uploads?name=Master.xml`);
    expect(options).toMatchObject({ file: { type: 'application/xml' } });

    await user.upload(input, new File(['<ENVELOPE/>'], 'Other.xml', { type: 'text/xml' }));
    expect(
      await within(tally).findByText(
        'This file is from another company in Tally than the one connected.',
      ),
    ).toBeVisible();
  });

  it('makes the orders file, saves it, and makes it again, with no Sync now', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {});
    const client = tallyClient(tallyConnection());
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const tally = await screen.findByRole('region', { name: 'Tally' });
    expect(within(tally).getByText(/2 accepted .* are waiting for a file/)).toBeVisible();
    expect(within(tally).queryByRole('button', { name: 'Sync now' })).toBeNull();
    await user.click(within(tally).getByRole('button', { name: 'Make the file' }));
    await waitFor(() =>
      expect(writesOf(client)[0]!.slice(0, 2)).toEqual([
        'POST',
        `/v1/erp-connections/${TALLY_ID}/orders-file`,
      ]),
    );
    await user.click(await within(tally).findByRole('button', { name: /^Save the file of/ }));
    await waitFor(() =>
      expect(go).toHaveBeenCalledWith('https://media.example/tally-orders.xml?signature=s'),
    );
    await user.click(within(tally).getByRole('button', { name: /^Make the file of .* again/ }));
    await waitFor(() =>
      expect(writesOf(client)[1]![3]).toMatchObject({ body: { again: FILE_RUN.id } }),
    );
  });

  it('maps Tally’s groups, voucher types and price levels, without Zoho’s or SAP’s fields', async () => {
    const client = tallyClient(tallyConnection());
    renderAt('/settings/erp', client);
    const user = userEvent.setup();
    const tally = await screen.findByRole('region', { name: 'Tally' });
    const form = within(tally).getByRole('form', { name: 'What comes in, and where' });
    expect(within(form).queryByLabelText(/daily calls/)).toBeNull();
    expect(within(form).queryByLabelText(/SAP field/)).toBeNull();
    expect(within(form).queryByRole('checkbox', { name: /Send accepted/ })).toBeNull();
    const groups = within(form).getByLabelText(/Customer groups/);
    await user.clear(groups);
    await user.type(groups, 'Sundry Debtors, Dealers');
    await user.click(within(form).getByRole('button', { name: 'Add a group' }));
    await user.type(within(form).getByLabelText(/Group in Tally/), 'Debtors - Nashik');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Territory' }), 'NSK');
    await user.click(within(form).getByRole('button', { name: 'Add a price level' }));
    await user.type(within(form).getByLabelText(/Price level in Tally/), 'Dealer');
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Into the price list' }),
      WHOLESALE,
    );
    await user.type(within(form).getByLabelText(/GST rate when Tally gives none/), '12');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        debtorGroups: ['Sundry Debtors', 'Dealers'],
        groupTerritories: { 'Debtors - Nashik': 'NSK' },
        priceBooks: [{ pricebookId: 'Dealer', priceList: WHOLESALE }],
        defaultTaxRate: '12',
        salesTypes: ['Sales'],
        receiptTypes: ['Receipt'],
        orderType: 'Sales Order',
      },
    });
  });
});
