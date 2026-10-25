import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  fakeClient,
  INVOICE,
  NO_BILLING,
  OPEN,
  PLAN,
  renderConsole,
  TENANT,
} from '../test-support';

const ACCOUNT = {
  legalName: 'Sunrise Agro Private Limited',
  gstin: null,
  address: 'Plot 9, MIDC, Nashik 422010',
  stateCode: '27',
  email: 'accounts@sunrise.example',
  language: 'en' as const,
  mandate: 'none' as const,
};

const MONTHLY = {
  id: '01a10000-0000-7000-8000-0000000000d1',
  plan: { id: PLAN.id, key: PLAN.key, name: PLAN.name },
  cycle: 'month' as const,
  committedSeats: null,
  status: 'active' as const,
  startedOn: '2026-10-25',
  term: null,
  endsOn: null,
};

/** A tenant page whose billing reads answer from `billing`, with `on` seeing each change. */
function page(
  billing: () => unknown,
  on: (method: string, path: string, body: unknown) => unknown = () => undefined,
) {
  return fakeClient(ADMIN, (method, path, body) => {
    const changed = method !== 'GET' ? on(method, path, body) : undefined;
    if (changed !== undefined) return changed;
    if (path.endsWith('/billing')) return billing();
    if (path.startsWith('/platform/v1/invoices?')) return { items: [INVOICE], nextCursor: null };
    if (path.endsWith('/entitlements')) return OPEN;
    if (path.includes('/usage')) return { items: [] };
    if (path === '/platform/v1/plans') return { items: [PLAN] };
    if (path.startsWith('/platform/v1/support-grants')) return { items: [] };
    return TENANT;
  });
}

describe("a tenant's billing in the console (D90)", () => {
  it('adds billing details before anything else, and lists the tenant’s invoices', async () => {
    let billing: object = NO_BILLING;
    let sent: unknown;
    const client = page(
      () => billing,
      (method, path, body) => {
        if (method === 'PUT' && path.endsWith('/billing-account')) {
          sent = body;
          billing = {
            ...NO_BILLING,
            account: { ...ACCOUNT, ...(body as object), mandate: 'none' },
          };
          return billing;
        }
        return undefined;
      },
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(await screen.findByText(/No billing details yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a subscription' })).not.toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Invoices' })).toHaveTextContent(
      'TL/26-27/00042',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add billing details' }));
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Sunrise Agro');
    await user.type(screen.getByLabelText(/^Address/), 'Plot 9, MIDC, Nashik 422010');
    await user.type(screen.getByLabelText(/^Billing email/), 'accounts@sunrise.example');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('accounts@sunrise.example')).toBeInTheDocument();
    expect(sent).toEqual({
      legalName: 'Sunrise Agro',
      gstin: null,
      address: 'Plot 9, MIDC, Nashik 422010',
      stateCode: '27',
      email: 'accounts@sunrise.example',
      language: 'en',
    });
    expect(screen.getByText('Not set up: invoices are paid by transfer.')).toBeInTheDocument();
  });

  it('starts an annual subscription with its committed seats', async () => {
    let sent: unknown;
    const client = page(
      () => ({ ...NO_BILLING, account: ACCOUNT }),
      (method, _path, body) => {
        if (method === 'PUT') {
          sent = body;
          return { ...NO_BILLING, account: ACCOUNT, subscription: MONTHLY };
        }
        return undefined;
      },
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start a subscription' }));
    await user.selectOptions(screen.getByLabelText('Billed'), 'Annually, upfront');
    const seats = screen.getByLabelText(/^Seats committed/);
    expect(seats).toHaveValue('12');
    await user.clear(seats);
    await user.type(seats, '20');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() =>
      expect(sent).toMatchObject({ planId: PLAN.id, cycle: 'year', committedSeats: 20 }),
    );
  });

  it('cancels a subscription with a reason, asking first', async () => {
    let sent: unknown;
    const client = page(
      () => ({ ...NO_BILLING, account: ACCOUNT, subscription: MONTHLY }),
      (method, path, body) => {
        if (method === 'POST' && path.endsWith('/subscription/cancel')) {
          sent = body;
          return {
            ...NO_BILLING,
            account: ACCOUNT,
            subscription: { ...MONTHLY, endsOn: '2026-10-25' },
          };
        }
        return undefined;
      },
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(await screen.findByText('Monthly, in arrears')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel the subscription' }));
    const confirm = screen.getByRole('group', { name: /Cancel Sunrise Agro’s subscription\?/ });
    const go = within(confirm).getByRole('button', { name: 'Cancel the subscription' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/^Why/), 'Moving to another product');
    await user.click(go);
    await waitFor(() => expect(sent).toEqual({ reason: 'Moving to another product' }));
  });

  it('sets up automatic payment, and says where an unpaid tenant stands', async () => {
    const client = page(
      () => ({
        ...NO_BILLING,
        account: { ...ACCOUNT, mandate: 'failed' },
        subscription: MONTHLY,
        outstanding: '6761.95',
        dunning: {
          overdueSince: '2026-11-04',
          stage: 'read_only',
          readOnlyOn: '2026-11-11',
          suspendOn: '2026-11-25',
          outstanding: '6761.95',
        },
      }),
      (method, path) =>
        method === 'POST' && path.endsWith('/mandate')
          ? { url: 'https://pay.example/authorise/abc' }
          : undefined,
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(
      await screen.findByText(/Overdue since 4 Nov 2026: read only until 25 Nov 2026/),
    ).toHaveTextContent('₹6,761.95');
    expect(screen.getByText(/The last charge was refused/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Set up automatic payment' }));
    expect(
      await screen.findByRole('link', { name: 'https://pay.example/authorise/abc' }),
    ).toBeInTheDocument();
  });
});
