import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  billingAnswer,
  fakeClient,
  OPEN,
  PLAN,
  QUIET_ACTIVITY,
  renderConsole,
  TENANT,
} from '../test-support';

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
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await within(table).findByRole('row', { name: /Zen Pharma/ })).toHaveTextContent(
      'Suspended',
    );
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('sums every tenant up in tiles, and gives each its seats and last activity', async () => {
    const limited = {
      ...TENANT,
      id: '01a10000-0000-7000-8000-0000000000b3',
      slug: 'quiet-co',
      name: 'Quiet Co',
      seatLimit: 25,
      lastActivityAt: null,
    };
    const client = fakeClient(ADMIN, (_method, path) =>
      path === '/platform/v1/tenants/summary'
        ? {
            tenants: 9,
            paying: 5,
            trial: 2,
            demo: 1,
            suspended: 1,
            seatsInUse: 120,
            seatsBought: 200,
            activeToday: 90,
          }
        : { items: [TENANT, limited], nextCursor: null },
    );
    renderConsole('/', client);
    expect(await screen.findByText('2 in trial · 1 demo')).toBeVisible();
    expect(screen.getByText('of 200 bought')).toBeVisible();
    expect(screen.getByText('75% of seats in use')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Tenants' });
    expect(within(table).getByRole('row', { name: /Quiet Co/ })).toHaveTextContent('12 / 25');
    expect(within(table).getByRole('row', { name: /Quiet Co/ })).toHaveTextContent('Never');
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
              terms: { en: 'SME · Beat plan · Beat', hi: '' },
            },
            {
              key: 'generic',
              version: 2,
              name: { en: 'Generic', hi: 'सामान्य' },
              description: { en: 'Anyone', hi: '' },
              terms: { en: 'Field user · Journey plan · Planned visit', hi: '' },
            },
          ],
        };
      }
      if (path === '/platform/v1/plans') {
        return { items: [PLAN, { ...PLAN, id: PLAN.id.replace('c1', 'c2'), active: false }] };
      }
      // The new tenant's page reads its plan and usage once it opens.
      if (billingAnswer(path)) return billingAnswer(path);
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
    const next = () => user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/^Step 1 of 5/)).toBeVisible();
    await user.type(await screen.findByLabelText(/^Organisation name/), 'Sunrise Agro & Co.');
    expect(screen.getByLabelText(/^Slug/)).toHaveValue('sunrise-agro-co');
    await next();
    // Each template says what it calls people, plans and their items.
    const agri = await screen.findByRole('button', { name: /Agri inputs/ });
    expect(agri).toHaveAttribute('aria-pressed', 'true');
    expect(within(agri).getByText('SME · Beat plan · Beat')).toBeVisible();
    expect(within(agri).getByText('For seed companies')).toBeVisible();
    const soFar = screen.getByRole('complementary', { name: 'So far' });
    expect(soFar).toHaveTextContent('Agri inputs, version 4');
    await next();
    await user.type(screen.getByLabelText(/^Name/), 'Kiran Patil');
    await user.type(screen.getByLabelText(/^Mobile number/), '98765 43210');
    await next();
    // Only plans on sale are offered.
    const plan = screen.getByLabelText('Plan');
    await waitFor(() => expect(within(plan).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(plan, 'Growth');
    await next();
    await user.click(screen.getByRole('button', { name: 'Create the tenant' }));
    // Refused for the slug: back on the first step, with the reason beside it.
    expect(await screen.findByText('Already used by another tenant')).toBeInTheDocument();
    expect(screen.getByText(/^Step 1 of 5/)).toBeVisible();
    await user.clear(screen.getByLabelText(/^Slug/));
    await user.type(screen.getByLabelText(/^Slug/), 'sunrise-agro');
    for (let step = 0; step < 4; step += 1) await next();
    await user.click(screen.getByRole('button', { name: 'Create the tenant' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tenants\/01/));
    expect(sent[1]).toMatchObject({
      name: 'Sunrise Agro & Co.',
      slug: 'sunrise-agro',
      template: 'agri',
      planId: PLAN.id,
      status: 'trial',
      trialDays: 30,
      admin: { name: 'Kiran Patil', phone: '9876543210' },
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
      if (billingAnswer(path)) return billingAnswer(path);
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

  it('heads a tenant with its slug, template and since when, its figures and a month of activity', async () => {
    const days = QUIET_ACTIVITY.days.map((day, index) => ({ ...day, active: index % 7 }));
    const client = fakeClient(ADMIN, (_method, path) => {
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) return { items: [] };
      if (path.endsWith('/activity')) {
        return { days, activeToday: 4, storageBytes: String(2.5 * 1024 ** 3) };
      }
      if (path === '/platform/v1/templates') {
        return {
          items: [
            {
              key: 'agri',
              version: 4,
              name: { en: 'Agri inputs', hi: 'कृषि इनपुट' },
              description: { en: 'Agri', hi: 'कृषि' },
              terms: { en: 'SME · Beat plan · Beat', hi: 'एसएमई · बीट प्लान · बीट' },
            },
          ],
        };
      }
      return { ...TENANT, seatLimit: 10 };
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(
      await screen.findByText('Agri inputs v4 · customer since 24 Oct 2026', { exact: false }),
    ).toBeVisible();
    expect(screen.getByText('12 / 10')).toBeVisible();
    expect(screen.getByText('2.5 GB')).toBeVisible();
    expect(screen.getByText(/^Up to 6 people a day/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Tenant tools' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Suspend' })).toHaveClass('danger');
  });
});
