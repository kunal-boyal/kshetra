import { ApiError } from '@thelamp/api-client';
import { REFERENCE_RATE_SETS, STATUTORY_RULES_VERSION } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderConsole } from '../test-support';

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

const rates = (reviewed = false) => ({
  rulesVersion: STATUTORY_RULES_VERSION,
  reference: true,
  sets: REFERENCE_RATE_SETS.map((set, index) => ({
    ...set,
    reviews:
      reviewed && index === 1
        ? [
            {
              rateSetId: set.id,
              reviewer: 'A. Example, Chartered Accountant (fictional)',
              reviewedOn: '2026-11-02',
              note: '',
              rulesVersion: STATUTORY_RULES_VERSION,
            },
          ]
        : [],
    reviewed: reviewed && index === 1,
  })),
});

describe('payroll rates in the console (D128)', () => {
  it('lists the dated sets, each awaiting review until one is recorded', async () => {
    const sent: unknown[] = [];
    let reviewed = false;
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'POST' && path === '/platform/v1/statutory-rates/reviews') {
        sent.push(body);
        reviewed = true;
      }
      return path.startsWith('/platform/v1/statutory-rates') ? rates(reviewed) : {};
    });
    renderConsole('/billing/payroll-rates', client);
    const sets = await screen.findByRole('list', { name: 'Rate sets' });
    expect(within(sets).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sets).getAllByText('Awaiting review')).toHaveLength(2);
    expect(screen.getByText(/These are the reference sets/)).toBeVisible();

    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: 'Record a review' });
    await user.type(within(form).getByRole('textbox', { name: /Reviewer/ }), 'A. Example');
    await user.type(within(form).getByLabelText(/Reviewed on/), '2026-11-02');
    await user.click(within(form).getByRole('button', { name: 'Record the review' }));
    await waitFor(() =>
      expect(sent).toEqual([
        {
          rateSetId: 'reference-2026-09',
          reviewer: 'A. Example',
          reviewedOn: '2026-11-02',
          note: '',
        },
      ]),
    );
    expect(await within(sets).findByText('Reviewed')).toBeVisible();
  });

  it('checks a new set before sending it', async () => {
    const sent: unknown[] = [];
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'POST' && path === '/platform/v1/statutory-rates') sent.push(body);
      return rates();
    });
    renderConsole('/billing/payroll-rates', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Add a rate set' });
    const json = within(form).getByRole('textbox', { name: /rate set/i });
    await user.clear(json);
    await user.click(json);
    await user.paste('{ "id": "x" ');
    await user.click(within(form).getByRole('button', { name: 'Add the set' }));
    expect(await within(form).findByText(/isn’t valid JSON|not valid JSON/i)).toBeVisible();
    expect(sent).toHaveLength(0);

    await user.clear(json);
    await user.click(json);
    await user.paste(
      JSON.stringify({ ...REFERENCE_RATE_SETS[1], id: 'vendor-2027-04', from: '2027-04-01' }),
    );
    await user.click(within(form).getByRole('button', { name: 'Add the set' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ id: 'vendor-2027-04', from: '2027-04-01' });
  });

  it('says what the server refused in a set, by its path, with its reason', async () => {
    const client = fakeClient(ADMIN, (method, path) => {
      if (method === 'POST' && path === '/platform/v1/statutory-rates') {
        return new ApiError(409, 'CONFLICT', 'A rate set has this ID.', [
          { path: 'id', issue: 'A rate set has this ID' },
        ]);
      }
      return rates();
    });
    renderConsole('/billing/payroll-rates', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Add a rate set' });
    const json = within(form).getByRole('textbox', { name: /rate set/i });
    await user.clear(json);
    await user.click(json);
    await user.paste(JSON.stringify(REFERENCE_RATE_SETS[1]));
    await user.click(within(form).getByRole('button', { name: 'Add the set' }));
    expect(await within(form).findByText('id: A rate set has this ID')).toBeVisible();
    expect(within(form).getByText('A rate set has this ID.')).toBeVisible();
  });

  it('shows support the sets without the forms', async () => {
    renderConsole(
      '/billing/payroll-rates',
      fakeClient(SUPPORT, () => rates()),
    );
    expect(await screen.findByRole('list', { name: 'Rate sets' })).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Record a review' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Add a rate set' })).toBeNull();
  });
});
