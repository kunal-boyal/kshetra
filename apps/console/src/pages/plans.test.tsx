import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, PLAN, renderConsole } from '../test-support';

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

describe('plans in the console (M23)', () => {
  it('lists plans with prices, modules, cap, tenants and whether they are on sale', async () => {
    const off = {
      ...PLAN,
      id: PLAN.id.replace('c1', 'c2'),
      key: 'starter',
      name: { en: 'Starter', hi: 'स्टार्टर' },
      limits: { users: null, storageGb: null },
      active: false,
      tenants: 0,
    };
    renderConsole(
      '/plans',
      fakeClient(ADMIN, () => ({ items: [PLAN, off] })),
    );
    const table = await screen.findByRole('table', { name: 'Plans' });
    const growth = within(table).getByRole('row', { name: /Growth/ });
    expect(growth).toHaveTextContent('₹499.00');
    expect(growth).toHaveTextContent('₹4,990.00');
    expect(growth).toHaveTextContent('Core, Leave and attendance, Orders');
    expect(growth).toHaveTextContent('25');
    expect(growth).toHaveTextContent('On sale');
    expect(within(table).getByRole('row', { name: /Starter/ })).toHaveTextContent(
      /No limit.*Switched off/,
    );
    expect(within(growth).getByRole('link', { name: 'Growth' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New plan/ })).toBeInTheDocument();
  });

  it('shows plans to every staff member, and changing them only to those who may', async () => {
    renderConsole(
      '/plans',
      fakeClient(SUPPORT, () => ({ items: [PLAN] })),
    );
    const table = await screen.findByRole('table', { name: 'Plans' });
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New plan/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plans' })).toHaveAttribute('aria-current', 'page');
  });

  it('adds a plan with its modules, cap and an add-on, under one ID', async () => {
    const sent: { id: string }[] = [];
    const client = fakeClient(ADMIN, (method, _path, body) => {
      if (method !== 'POST') return { items: [] };
      sent.push(body as { id: string });
      if (sent.length === 1) {
        return new ApiError(422, 'VALIDATION', 'x', [
          { path: 'key', issue: 'Already used by another plan' },
        ]);
      }
      return { ...PLAN, ...(body as object) };
    });
    const { router } = renderConsole('/plans/new', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Key/), 'team');
    await user.type(screen.getByLabelText(/^Name in English/), 'Team');
    await user.type(screen.getByLabelText(/^Name in Hindi/), 'टीम');
    await user.type(screen.getByLabelText(/^Price per person a month/), '350');
    await user.type(screen.getByLabelText(/^Price per person a year/), '3500');
    // Core comes with every plan.
    expect(screen.getByRole('checkbox', { name: /Core/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Core/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Expenses' }));
    await user.type(screen.getByLabelText(/^People active at once/), '40');
    await user.click(screen.getByRole('button', { name: 'Add an add-on' }));
    await user.type(screen.getByLabelText(/^Add-on key/), 'sms_pack');
    await user.type(screen.getByLabelText(/^Price a month/), '250');
    const addons = screen.getByRole('group', { name: 'Add-ons' });
    await user.type(within(addons).getByLabelText(/^Name in English/), 'SMS pack');
    await user.type(within(addons).getByLabelText(/^Name in Hindi/), 'SMS पैक');
    await user.click(screen.getByRole('button', { name: 'Add the plan' }));
    expect(await screen.findByText('Already used by another plan')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Key/));
    await user.type(screen.getByLabelText(/^Key/), 'team_plan');
    await user.click(screen.getByRole('button', { name: 'Add the plan' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'));
    expect(sent[1]).toEqual({
      id: sent[0]!.id,
      key: 'team_plan',
      name: { en: 'Team', hi: 'टीम' },
      priceMonth: '350',
      priceYear: '3500',
      modules: ['core', 'expenses'],
      limits: { users: 40, storageGb: null },
      addons: [{ key: 'sms_pack', name: { en: 'SMS pack', hi: 'SMS पैक' }, price: '250' }],
      active: true,
    });
  });

  it('changes a plan, keeping its key, and says its tenants follow', async () => {
    let put: unknown;
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'PUT') {
        expect(path).toBe(`/platform/v1/plans/${PLAN.id}`);
        put = body;
        return { ...PLAN, ...(body as object) };
      }
      return { items: [PLAN] };
    });
    const { router } = renderConsole(`/plans/${PLAN.id}`, client);
    expect(await screen.findByRole('heading', { name: 'Growth' })).toBeInTheDocument();
    expect(
      screen.getByText('3 tenants are on this plan and follow any change at once.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Key/)).toHaveAttribute('readonly');
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/^Price per person a month/));
    await user.type(screen.getByLabelText(/^Price per person a month/), '525.50');
    await user.click(screen.getByRole('button', { name: 'Remove this add-on' }));
    await user.click(screen.getByRole('checkbox', { name: /^On sale/ }));
    await user.click(screen.getByRole('button', { name: 'Save the plan' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'));
    expect(put).toEqual({
      key: 'growth',
      name: PLAN.name,
      priceMonth: '525.50',
      priceYear: '4990.00',
      modules: ['core', 'leave_attendance', 'orders'],
      limits: { users: 25, storageGb: 50 },
      addons: [],
      active: false,
    });
  });

  it('says so when the plan is not there', async () => {
    renderConsole(
      `/plans/${PLAN.id}`,
      fakeClient(ADMIN, () => ({ items: [] })),
    );
    expect(await screen.findByText('There is no such plan.')).toBeInTheDocument();
  });
});
