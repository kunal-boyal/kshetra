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
