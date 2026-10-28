import { REQUEST_TYPES } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

/** The approval chains screen (spec 5.9, decision D74). */

const noun = (one: string, other: string) => ({
  en: { one, other },
  hi: { one, other },
});

const ROLES = {
  items: [
    { key: 'tenant_admin', name: { en: 'Tenant admin', hi: 'टेनेंट एडमिन' } },
    { key: 'manager', name: { en: 'Manager', hi: 'मैनेजर' } },
  ].map((role, index) => ({
    ...role,
    id: `01a10000-0000-7000-8000-00000000004${index}`,
    scope: 'tenant',
    permissions: ['workflow.manage'],
    mobileOnly: false,
    system: true,
  })),
};

const DESIGNATIONS = {
  items: [
    { key: 'head', name: noun('Head', 'Heads'), level: 1 },
    { key: 'manager', name: noun('Manager', 'Managers'), level: 2 },
  ].map((designation, index) => ({
    ...designation,
    id: `01a10000-0000-7000-8000-00000000005${index}`,
    ranked: false,
    defaultRole: 'manager',
    canHaveReports: true,
  })),
};

const chains = (leave: object[] = []) => ({
  fallbackRole: 'tenant_admin',
  chains: REQUEST_TYPES.map((requestType) => {
    const steps = requestType === 'leave' ? leave : [];
    return {
      requestType,
      version: steps.length > 0 ? 1 : 0,
      steps,
      updatedAt: steps.length > 0 ? '2026-10-20T06:30:00.000Z' : null,
      updatedBy:
        steps.length > 0 ? { id: '01a10000-0000-7000-8000-000000000001', name: 'Anita Rao' } : null,
    };
  }),
});

const PAGES = (leave: object[] = []) => ({
  '/v1/workflows': chains(leave),
  '/v1/roles': ROLES,
  '/v1/designations': DESIGNATIONS,
  '/v1/account-types': { items: [] },
  '/v1/users': { items: [], nextCursor: null },
});

const MANAGER = { approver: { type: 'reporting_manager', level: 1 }, lineDecisions: false };

describe('approval chains (spec 5.9)', () => {
  it('lists each type with its chain in a line, and shows the chosen one by condition', async () => {
    const client = fakeClient(
      PAGES([
        { ...MANAGER, reminderAfterHours: 48, escalation: { afterHours: 72, to: 'manager' } },
        {
          approver: { type: 'nearest_designation', designation: 'head' },
          condition: { match: 'all', clauses: [{ field: 'leave_days', op: 'gt', value: 3 }] },
          lineDecisions: false,
        },
      ]),
      {},
      ['workflow.manage'],
    );
    renderAt('/settings/approvals', client);
    const user = userEvent.setup();
    const types = await screen.findByRole('list', { name: 'Request types' });
    expect(
      within(types).getByText('Their manager, then Head · some steps by condition'),
    ).toBeVisible();
    expect(within(types).getAllByText('The requester’s manager').length).toBeGreaterThan(0);

    const leave = screen.getByRole('complementary', { name: 'Leave' });
    expect(within(leave).getByText('Version 1')).toBeVisible();
    expect(within(leave).getByText('Always')).toBeVisible();
    expect(
      within(leave).getByText('A reminder after 48 hours · After 72 hours, it goes to Manager'),
    ).toBeVisible();
    expect(within(leave).getByText('When Leave days more than 3')).toBeVisible();
    expect(within(leave).getByText(/The nearest above with a designation: Head/)).toBeVisible();
    expect(within(leave).getByText(/Version 1, saved .* by Anita Rao/)).toBeVisible();

    await user.click(within(types).getByRole('button', { name: /Expense claims/ }));
    const claims = screen.getByRole('complementary', { name: 'Expense claims' });
    expect(within(claims).getByText('No chain')).toBeVisible();
    expect(
      within(claims).getByText('No chain: requests go to the requester’s manager.'),
    ).toBeVisible();
  });

  it('adds a step with a condition and saves the chain on the version shown', async () => {
    const client = fakeClient(
      PAGES([MANAGER]),
      {
        'PUT /v1/workflows/leave': ({ body }) => ({
          ...(body as object),
          requestType: 'leave',
          version: 2,
          updatedAt: null,
          updatedBy: null,
        }),
      },
      ['workflow.manage'],
    );
    renderAt('/settings/approvals', client);
    const user = userEvent.setup();
    const leave = await screen.findByRole('region', { name: 'Leave' });
    await user.click(within(leave).getByRole('button', { name: 'Edit: Leave' }));
    const form = within(leave).getByRole('form', { name: 'Leave' });
    await user.click(within(form).getByRole('button', { name: 'Add a step' }));
    const second = within(form).getByRole('group', { name: 'Step 2' });
    await user.selectOptions(
      within(second).getByRole('combobox', { name: 'Who decides' }),
      'nearest_designation',
    );
    await user.selectOptions(within(second).getByRole('combobox', { name: 'Designation' }), 'head');
    await user.click(within(second).getByRole('button', { name: 'Add a condition' }));
    const condition = within(second).getByRole('group', { name: 'Use this step only when' });
    await user.selectOptions(
      within(condition).getByRole('combobox', { name: 'Field' }),
      'leave_days',
    );
    await user.selectOptions(within(condition).getByRole('combobox', { name: 'Is' }), 'gt');
    await user.type(within(condition).getByRole('textbox', { name: 'Value' }), '3');
    await user.click(within(form).getByRole('button', { name: 'Save chain' }));
    expect(await screen.findByText('Saved as version 2.')).toBeVisible();
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          version: 1,
          steps: [
            MANAGER,
            {
              approver: { type: 'nearest_designation', designation: 'head' },
              condition: { match: 'all', clauses: [{ field: 'leave_days', op: 'gt', value: 3 }] },
            },
          ],
        },
      }),
    );
  });

  it('shows the server’s problems beside the fields they name', async () => {
    const { ApiError } = await import('@thelamp/api-client');
    const client = fakeClient(
      PAGES([MANAGER]),
      {
        'PUT /v1/workflows/leave': () => {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'steps[0].reminderAfterHours', issue: 'Remind before escalating' },
          ]);
        },
      },
      ['workflow.manage'],
    );
    renderAt('/settings/approvals', client);
    const user = userEvent.setup();
    const leave = await screen.findByRole('region', { name: 'Leave' });
    await user.click(within(leave).getByRole('button', { name: 'Edit: Leave' }));
    await user.click(within(leave).getByRole('button', { name: 'Save chain' }));
    expect(await within(leave).findByText('Remind before escalating')).toBeVisible();
  });

  it('sets the fallback role', async () => {
    const client = fakeClient(PAGES(), { 'PUT /v1/workflows/fallback': () => chains() }, [
      'workflow.manage',
    ]);
    renderAt('/settings/approvals', client);
    const user = userEvent.setup();
    const fallback = await screen.findByRole('region', { name: 'When no step remains' });
    await user.selectOptions(within(fallback).getByRole('combobox', { name: 'Role' }), 'manager');
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({ body: { role: 'manager' } }),
    );
  });
});
