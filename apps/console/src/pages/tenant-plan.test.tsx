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
  renderConsole,
  TENANT,
} from '../test-support';

const ON_GROWTH = {
  plan: { id: PLAN.id, key: PLAN.key, name: PLAN.name },
  extraModules: ['expenses'],
  modules: ['core', 'leave_attendance', 'orders', 'expenses'],
  limits: {
    users: 25,
    storageGb: 50,
    apiPerMinute: 300,
    requestsPerMinute: 10_000,
    queueSlots: null,
    importRows: 50_000,
    exportRows: null,
  },
  ownLimits: {},
};

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

describe("a tenant's plan in the console (D89)", () => {
  it('shows the plan, the modules open, what was added and the caps in use', async () => {
    const client = fakeClient(SUPPORT, (_method, path) => {
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return ON_GROWTH;
      if (path.includes('/usage')) return { items: [] };
      return { ...TENANT, plan: ON_GROWTH.plan };
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    // The first render of the file is the slowest; give it time on a busy machine.
    const card = (await screen.findByRole('heading', { name: 'Plan' }, { timeout: 5000 }))
      .parentElement!;
    expect(within(card).getByText('Growth')).toBeInTheDocument();
    expect(
      within(card).getByText('Core, Leave and attendance, Orders, Expenses'),
    ).toBeInTheDocument();
    expect(within(card).getByText('Expenses')).toBeInTheDocument();
    expect(within(card).getByText('12 of 25 active')).toBeInTheDocument();
    expect(within(card).getByText('50 GB')).toBeInTheDocument();
    expect(within(card).getByText('300 a minute')).toBeInTheDocument();
    // The whole organisation's requests, and the heavy-job, import and export limits (D98), the
    // open ones at their defaults.
    expect(within(card).getByText('10,000 a minute')).toBeInTheDocument();
    const fact = (label: string) => within(card).getByText(label).nextElementSibling;
    expect(fact('Heavy jobs at once')).toHaveTextContent('2');
    expect(fact('Rows per import')).toHaveTextContent('50,000');
    expect(fact('Rows per export')).toHaveTextContent('1,00,000');
    // Support reads the plan but doesn't change it.
    expect(screen.queryByRole('button', { name: 'Change the plan' })).not.toBeInTheDocument();
  });

  it('puts a tenant on a plan, with a module beyond it and its own cap', async () => {
    let entitled: object = OPEN;
    const puts: unknown[] = [];
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'PUT') {
        puts.push(body);
        if (puts.length === 1) {
          return new ApiError(422, 'VALIDATION', 'x', [
            { path: 'limits.users', issue: 'Must be at least 1' },
          ]);
        }
        entitled = { ...ON_GROWTH, limits: { users: 30, storageGb: null, apiPerMinute: 300 } };
        return entitled;
      }
      if (path === '/platform/v1/plans') {
        return {
          items: [
            PLAN,
            {
              ...PLAN,
              id: PLAN.id.replace('c1', 'c2'),
              name: { en: 'Old', hi: 'पुराना' },
              active: false,
            },
          ],
        };
      }
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return entitled;
      if (path.includes('/usage')) return { items: [] };
      return TENANT;
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(
      await screen.findByText('No plan: every module is open and nothing is capped.'),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change the plan' }));
    const plan = screen.getByLabelText('Plan');
    // A switched-off plan isn't offered to a tenant that isn't on it.
    await waitFor(() => expect(within(plan).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(plan, 'Growth');
    // Only modules the plan leaves out can be added.
    const extra = screen.getByRole('group', { name: 'Added for this tenant' });
    expect(within(extra).queryByRole('checkbox', { name: 'Orders' })).not.toBeInTheDocument();
    await user.click(within(extra).getByRole('checkbox', { name: 'Expenses' }));
    expect(screen.getByLabelText('People active at once')).toHaveDisplayValue(
      'As the plan says (25)',
    );
    await user.selectOptions(
      screen.getByLabelText('People active at once'),
      'A number for this tenant',
    );
    await user.type(screen.getByLabelText(/^People \*/), '30');
    await user.selectOptions(screen.getByLabelText('Storage (GB)'), 'No limit');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be at least 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('12 of 30 active')).toBeInTheDocument();
    expect(puts[1]).toEqual({
      planId: PLAN.id,
      extraModules: ['expenses'],
      limits: { users: 30, storageGb: null },
    });
  });

  it('keeps limits that follow the plan out of what it sends, and can take the plan away', async () => {
    let put: unknown;
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'PUT') {
        put = body;
        return OPEN;
      }
      if (path === '/platform/v1/plans') return { items: [PLAN] };
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return { ...ON_GROWTH, ownLimits: { storageGb: null } };
      if (path.includes('/usage')) return { items: [] };
      return TENANT;
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change the plan' }));
    expect(screen.getByLabelText('Storage (GB)')).toHaveDisplayValue('No limit');
    await user.selectOptions(screen.getByLabelText('Plan'), 'No plan: every module open');
    expect(screen.queryByRole('group', { name: 'Added for this tenant' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toEqual({ planId: null, extraModules: [], limits: { storageGb: null } }),
    );
  });
});

describe("a tenant's usage in the console (M22)", () => {
  it('shows each month newest first, in the reader’s figures', async () => {
    const client = fakeClient(ADMIN, (_method, path) => {
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) {
        expect(path).toContain('months=6');
        return {
          items: [
            {
              period: '2026-10',
              metrics: {
                seats: '11.4839',
                active_users: '9.0000',
                storage_bytes: '2684354560.0000',
                sms: '42.0000',
                whatsapp: '0.0000',
                api_calls: '18250.0000',
              },
              updatedAt: '2026-10-25T10:00:00.000Z',
            },
            {
              period: '2026-09',
              metrics: { seats: '8.0000', storage_bytes: '52428800.0000' },
              updatedAt: '2026-09-30T23:00:00.000Z',
            },
          ],
        };
      }
      return TENANT;
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    const table = await screen.findByRole('table', { name: 'Usage' });
    const october = within(table).getByRole('row', { name: /October 2026/ });
    expect(october).toHaveTextContent('11.48');
    expect(october).toHaveTextContent('2.5 GB');
    expect(october).toHaveTextContent('18,250');
    const september = within(table).getByRole('row', { name: /September 2026/ });
    expect(september).toHaveTextContent('50 MB');
    expect(september).toHaveTextContent('—');
  });

  it('says when nothing has been measured yet', async () => {
    const client = fakeClient(ADMIN, (_method, path) => {
      if (billingAnswer(path)) return billingAnswer(path);
      if (path.endsWith('/entitlements')) return OPEN;
      if (path.includes('/usage')) return { items: [] };
      return TENANT;
    });
    renderConsole(`/tenants/${TENANT.id}`, client);
    expect(
      await screen.findByText('Nothing measured yet. The first figures arrive within the hour.'),
    ).toBeInTheDocument();
  });
});
