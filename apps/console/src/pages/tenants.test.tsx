import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, OPEN, PLAN, renderConsole, TENANT } from '../test-support';

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

describe('tenants in the console (M22)', () => {
  it('lists tenants with their status, template, cell and people, and pages on', async () => {
    const second = {
      ...TENANT,
      id: '01a10000-0000-7000-8000-0000000000b2',
      slug: 'zen-pharma',
      name: 'Zen Pharma',
      status: 'suspended' as const,
    };
    const client = fakeClient(ADMIN, (_method, path) =>
      path.includes('cursor=')
        ? { items: [second], nextCursor: null }
        : { items: [TENANT], nextCursor: TENANT.slug },
    );
    renderConsole('/', client);
    const table = await screen.findByRole('table', { name: 'Tenants' });
    const row = within(table).getByRole('row', { name: /Sunrise Agro/ });
    expect(row).toHaveTextContent('sunrise-agro');
    expect(row).toHaveTextContent('Trial');
    expect(row).toHaveTextContent('agri');
    expect(row).toHaveTextContent('12');
    expect(row).toHaveTextContent('No plan');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(table).findByRole('row', { name: /Zen Pharma/ })).toHaveTextContent(
      'Suspended',
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('filters by status and search, and offers creating only to those who may', async () => {
    const client = fakeClient(SUPPORT, () => ({ items: [], nextCursor: null }));
    renderConsole('/', client);
    expect(await screen.findByText('No tenants here')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New tenant/ })).not.toBeInTheDocument();
    // Support doesn't see staff in the rail.
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'suspended');
    await user.type(screen.getByLabelText('Search by name or slug'), 'zen');
    await waitFor(() =>
      expect(client.request).toHaveBeenCalledWith(
        'GET',
        '/platform/v1/tenants?limit=50&status=suspended&q=zen',
        expect.anything(),
      ),
    );
  });

  it('creates a tenant from a template, with a slug from its name', async () => {
    const sent: unknown[] = [];
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (path === '/platform/v1/templates') {
        return {
          items: [
            {
              key: 'agri',
              version: 4,
              name: { en: 'Agri inputs', hi: 'कृषि' },
              description: { en: 'For seed companies', hi: '' },
            },
            {
              key: 'generic',
              version: 2,
              name: { en: 'Generic', hi: 'सामान्य' },
              description: { en: 'Anyone', hi: '' },
            },
          ],
        };
      }
      if (path === '/platform/v1/plans') {
        return { items: [PLAN, { ...PLAN, id: PLAN.id.replace('c1', 'c2'), active: false }] };
      }
      // The new tenant's page reads its plan and usage once it opens.
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) return { items: [] };
      if (method === 'POST') {
        sent.push(body);
        if (sent.length === 1) {
          return new ApiError(409, 'CONFLICT', 'x', [
            { path: 'slug', issue: 'Already used by another tenant' },
          ]);
        }
        return { ...TENANT, id: (body as { id: string }).id };
      }
      return TENANT;
    });
    const { router } = renderConsole('/tenants/new', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Organisation name/), 'Sunrise Agro & Co.');
    expect(screen.getByLabelText(/^Slug/)).toHaveValue('sunrise-agro-co');
    expect(await screen.findByText('For seed companies')).toBeInTheDocument();
    // Only plans on sale are offered.
    const plan = screen.getByLabelText('Plan');
    await waitFor(() => expect(within(plan).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(plan, 'Growth');
    await user.type(screen.getByLabelText(/^Name/), 'Kiran Patil');
    await user.type(screen.getByLabelText(/^Mobile number/), '98765 43210');
    await user.click(screen.getByRole('button', { name: 'Create the tenant' }));
    expect(await screen.findByText('Already used by another tenant')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Slug/));
    await user.type(screen.getByLabelText(/^Slug/), 'sunrise-agro');
    await user.click(screen.getByRole('button', { name: 'Create the tenant' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tenants\/01/));
    expect(sent[1]).toMatchObject({
      name: 'Sunrise Agro & Co.',
      slug: 'sunrise-agro',
      template: 'agri',
      planId: PLAN.id,
      status: 'trial',
      trialDays: 30,
      admin: { name: 'Kiran Patil', phone: '98765 43210' },
    });
    // The same ID both times, so a create sent twice makes one tenant.
    expect((sent[0] as { id: string }).id).toBe((sent[1] as { id: string }).id);
  });

  it('suspends a tenant with a reason, asking first, and reactivates it', async () => {
    let status: string = 'trial';
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'POST' && path.endsWith('/suspend')) {
        expect(body).toEqual({ reason: 'Unpaid for two months' });
        status = 'suspended';
      }
      if (method === 'POST' && path.endsWith('/reactivate')) status = 'trial';
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) return { items: [] };
      return { ...TENANT, status };
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(await screen.findByRole('heading', { name: 'Sunrise Agro' })).toBeInTheDocument();
    expect(screen.getByText('local · ap-south-1 · shared')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    const confirm = screen.getByRole('group', { name: /Suspend Sunrise Agro\?/ });
    const go = within(confirm).getByRole('button', { name: 'Suspend' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/^Why/), 'Unpaid for two months');
    await user.click(go);
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });
});
