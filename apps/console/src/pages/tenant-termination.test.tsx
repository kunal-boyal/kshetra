import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, billingAnswer, fakeClient, OPEN, renderConsole, TENANT } from '../test-support';

const READY = {
  id: '01a10000-0000-7000-8000-0000000000f5',
  status: 'ready' as const,
  requestedBy: { id: null, name: 'Ravi Shah' },
  fileName: 'data-export-2026-10-26.zip',
  bytes: 52_428_800,
  sha256: 'a'.repeat(64),
  tables: 84,
  rows: 120_431,
  files: 312,
  keyId: '0123456789abcdef',
  error: null,
  createdAt: '2026-10-26T05:00:00.000Z',
  finishedAt: '2026-10-26T05:04:00.000Z',
  expiresAt: '2026-11-02T05:04:00.000Z',
  download: null,
};

const TERMINATED = {
  ...TENANT,
  status: 'terminated' as const,
  terminatedAt: '2026-10-26T05:00:00.000Z',
  deletesAt: '2026-11-25T05:00:00.000Z',
};

/** A tenant page whose tenant is `tenant()`, with `on` seeing each change. */
function page(
  tenant: () => object,
  on: (method: string, path: string, body: unknown) => unknown = () => undefined,
) {
  return fakeClient(ADMIN, (method, path, body) => {
    const changed = method !== 'GET' ? on(method, path, body) : undefined;
    if (changed !== undefined) return changed;
    const billing = billingAnswer(path);
    if (billing !== undefined) return billing;
    if (path.endsWith('/entitlements')) return OPEN;
    if (path.includes('/usage')) return { items: [] };
    if (path === '/platform/v1/plans') return { items: [] };
    if (path.endsWith('/data-exports')) return { items: [READY] };
    if (path.endsWith(`/data-exports/${READY.id}`)) {
      return {
        ...READY,
        download: { url: 'https://files.example/final.zip', expiresAt: READY.expiresAt },
      };
    }
    return tenant();
  });
}

describe('terminating a tenant in the console (D95)', () => {
  it('terminates a suspended tenant only once its slug is typed', async () => {
    let tenant: object = { ...TENANT, status: 'suspended' };
    let sent: unknown;
    const client = page(
      () => tenant,
      (method, path, body) => {
        if (path.endsWith('/terminate')) {
          sent = body;
          tenant = TERMINATED;
          return tenant;
        }
        return undefined;
      },
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    const card = await screen.findByRole('region', { name: 'Termination' });
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Terminate' }));
    const confirm = within(card).getByRole('group');
    const terminate = within(confirm).getByRole('button', { name: 'Terminate' });
    await user.type(within(confirm).getByLabelText(/^Why/), 'Contract ended');
    expect(terminate).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/Type sunrise-agro to confirm/), 'sunrise-agr');
    expect(terminate).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/Type sunrise-agro to confirm/), 'o');
    await user.click(terminate);
    await waitFor(() =>
      expect(sent).toEqual({ reason: 'Contract ended', confirmSlug: 'sunrise-agro' }),
    );
    expect(
      await screen.findByText('Terminated on 26 Oct 2026. Its data is deleted on 25 Nov 2026.'),
    ).toBeVisible();
  });

  it('lists the exports for the customer, copies a day’s link, and undoes after asking', async () => {
    let tenant: object = TERMINATED;
    const client = page(
      () => tenant,
      (method, path) => {
        if (path.endsWith('/undo-termination')) {
          tenant = { ...TENANT, status: 'suspended' };
          return tenant;
        }
        return undefined;
      },
    );
    renderConsole(`/tenants/${TENANT.id}`, client);
    const card = await screen.findByRole('region', { name: 'Termination' });
    expect(await within(card).findByText(/asked by Ravi Shah · Ready/)).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Copy a download link' }));
    expect(await within(card).findByLabelText('Download link')).toHaveValue(
      'https://files.example/final.zip',
    );

    await user.click(within(card).getByRole('button', { name: 'Undo termination' }));
    expect(
      within(card).getByText(
        'Undo the termination of Sunrise Agro? It is suspended again, and nothing is deleted.',
      ),
    ).toBeVisible();
    await user.click(
      within(within(card).getByRole('group')).getByRole('button', { name: 'Undo termination' }),
    );
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeVisible();
  });

  it('says when a tenant’s data was deleted', async () => {
    renderConsole(
      `/tenants/${TENANT.id}`,
      page(() => ({ ...TERMINATED, deletesAt: null, deletedAt: '2026-11-25T06:00:00.000Z' })),
    );
    expect(
      await screen.findByText('Its data was deleted on 25 Nov 2026. Its invoices are kept.'),
    ).toBeVisible();
  });
});
