import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, fakeClient, INVOICE, renderConsole } from '../test-support';

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

const SETTINGS = {
  seller: {
    legalName: 'Example Field Software Private Limited (fictional)',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Unit 4, Example Business Park, Pune 411045',
    stateCode: '27',
    email: 'billing@example.com',
    sac: '998314',
  },
  invoicePrefix: 'EX',
  gstRate: '18',
  paymentTermsDays: 15,
  graceDays: 7,
  readOnlyDays: 14,
  example: true,
  ready: true,
};

describe('invoices in the console (D90)', () => {
  it('lists every tenant’s invoices with their state, and filters them', async () => {
    const overdue = {
      ...INVOICE,
      id: INVOICE.id.replace('e1', 'e2'),
      number: 'TL/26-27/00041',
      dueOn: '2026-01-01',
    };
    const paid = {
      ...INVOICE,
      id: INVOICE.id.replace('e1', 'e3'),
      number: 'TL/26-27/00040',
      status: 'paid' as const,
    };
    const client = fakeClient(ADMIN, (_method, path) =>
      path === '/platform/v1/billing/settings'
        ? { ...SETTINGS, ready: false }
        : { items: [INVOICE, overdue, paid], nextCursor: null },
    );
    renderConsole('/billing', client);
    const table = await screen.findByRole('table', { name: 'Invoices' });
    const unpaid = within(table).getByRole('row', { name: /00042/ });
    expect(unpaid).toHaveTextContent('Sunrise Agro');
    expect(unpaid).toHaveTextContent('Month');
    expect(unpaid).toHaveTextContent('₹6,761.95');
    expect(unpaid).toHaveTextContent('Unpaid');
    expect(within(table).getByRole('row', { name: /00041/ })).toHaveTextContent('Overdue');
    expect(within(table).getByRole('row', { name: /00040/ })).toHaveTextContent('Paid');
    expect(
      screen.getByText(/can’t be issued until the seller’s details are set/),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'paid');
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        '/platform/v1/invoices?limit=50&status=paid',
        expect.anything(),
      ),
    );
  });

  it('saves the seller’s details, showing the API’s field errors', async () => {
    const sent: unknown[] = [];
    const client = fakeClient(ADMIN, (method, _path, body) => {
      if (method !== 'PUT') return SETTINGS;
      sent.push(body);
      return sent.length === 1
        ? new ApiError(400, 'VALIDATION', 'x', [
            { path: 'seller.gstin', issue: 'The GSTIN is for another state' },
          ])
        : { ...SETTINGS, ...(body as object), example: false };
    });
    renderConsole('/billing/settings', client);
    expect(await screen.findByText(/fictional example details/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/^Legal name/));
    await user.type(screen.getByLabelText(/^Legal name/), 'Lamp Field Software Private Limited');
    await user.selectOptions(screen.getByLabelText('State'), 'Karnataka');
    await user.clear(screen.getByLabelText(/^Days of grace/));
    await user.type(screen.getByLabelText(/^Days of grace/), '10');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));
    expect(await screen.findByText('The GSTIN is for another state')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('State'), 'Maharashtra');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(sent[1]).toEqual({
      seller: { ...SETTINGS.seller, legalName: 'Lamp Field Software Private Limited' },
      invoicePrefix: 'EX',
      gstRate: '18',
      paymentTermsDays: 15,
      graceDays: 10,
      readOnlyDays: 14,
    });
  });

  it('shows the settings read only to staff who may not change them', async () => {
    renderConsole(
      '/billing/settings',
      fakeClient(SUPPORT, () => SETTINGS),
    );
    expect(await screen.findByLabelText(/^Legal name/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save the settings' })).not.toBeInTheDocument();
  });
});

describe('an invoice in the console (D90)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows what was issued, with GST split in half within the state, and its PDF', async () => {
    const client = fakeClient(ADMIN, () => INVOICE);
    renderConsole(`/invoices/${INVOICE.id}`, client);
    expect(
      await screen.findByRole('heading', { name: 'Invoice TL/26-27/00042' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Maharashtra (27)')).toBeInTheDocument();
    expect(screen.getByText('CGST at 9%')).toBeInTheDocument();
    expect(screen.getByText('SGST at 9%')).toBeInTheDocument();
    expect(screen.getByText('Still owed').nextSibling).toHaveTextContent('₹6,761.95');
    expect(screen.getByText('No payments yet.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download the PDF' }));
    await waitFor(() =>
      expect(client.file).toHaveBeenCalledWith(`/platform/v1/invoices/${INVOICE.id}/pdf`),
    );
  });

  it('records a payment once under one ID, and offers what is still owed next', async () => {
    const sent: { id: string }[] = [];
    let current = INVOICE;
    const client = fakeClient(ADMIN, (method, _path, body) => {
      if (method !== 'POST') return current;
      sent.push(body as { id: string });
      if (sent.length === 1) return new ApiError(0, 'INTERNAL', 'x');
      current = {
        ...INVOICE,
        paid: '1000.00',
        payments: [
          {
            id: (body as { id: string }).id,
            amount: '1000.00',
            method: 'upi',
            reference: 'UTR 4471',
            receivedOn: '2026-11-05',
            recordedAt: '2026-11-05T10:00:00.000Z',
          },
        ],
      };
      return current;
    });
    renderConsole(`/invoices/${INVOICE.id}`, client);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/^Amount/);
    expect(amount).toHaveValue('6761.95');
    await user.clear(amount);
    await user.type(amount, '1000');
    await user.selectOptions(screen.getByLabelText('Method'), 'UPI');
    await user.type(screen.getByLabelText(/^Reference/), 'UTR 4471');
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record a payment' }));
    await waitFor(() => expect(screen.getByLabelText(/^Amount/)).toHaveValue('5761.95'));
    expect(sent[1]).toMatchObject({ amount: '1000', method: 'upi', reference: 'UTR 4471' });
    // The retry carried the same ID, so the server records it once.
    expect(sent[1]!.id).toBe(sent[0]!.id);
    expect(await screen.findByRole('table', { name: 'Payments' })).toHaveTextContent('UPI');
  });
});
