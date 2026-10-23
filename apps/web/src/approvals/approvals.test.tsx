import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const DEPOT = '01a10000-0000-7000-8000-000000000081';
const SHOP = '01a10000-0000-7000-8000-000000000082';
const SME = '01a10000-0000-7000-8000-000000000004';
const ASM = '01a10000-0000-7000-8000-000000000003';
const ADMIN = '01a10000-0000-7000-8000-000000000001';
const FIRST = '01a10000-0000-7000-8000-000000000090';
const SECOND = '01a10000-0000-7000-8000-000000000091';
const MOVE = '01a10000-0000-7000-8000-000000000092';
const MINE = '01a10000-0000-7000-8000-000000000093';

const suresh = { id: SME, code: 'SUN-004', name: 'Suresh Rao' };
const step = (overrides: Record<string, unknown>) => ({
  index: 0,
  approvers: [{ id: ASM, code: 'SUN-003', name: 'Meena Shah' }],
  status: 'pending',
  actedBy: null,
  actedAt: null,
  note: null,
  skipReason: null,
  escalated: false,
  fallback: false,
  ...overrides,
});

function request(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    requestType: 'new_account',
    requestId: DEPOT,
    subject: { title, accountId: DEPOT },
    requester: suresh,
    status: 'pending',
    version: 1,
    steps: [],
    cancellable: false,
    bulk: true,
    page: null,
    createdAt: '2026-10-12T05:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

const ACT = ['approval.act', 'account.view'] as const;

describe('the approvals inbox', () => {
  it('approves with the version it saw, and rejects only with a reason', async () => {
    const one = request(FIRST, 'Beej Bhandar (D-81)');
    const client = fakeClient(
      { '/v1/approvals/inbox': { items: [one], nextCursor: null, counts: { new_account: 1 } } },
      {
        [`POST /v1/approvals/${FIRST}/decision`]: ({ body }) => {
          const { decision, note } = body as { decision: string; note?: string };
          if (decision === 'reject' && (note?.length ?? 0) < 3) {
            throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
              { path: 'note', issue: 'Say why, in at least 3 characters' },
            ]);
          }
          return { ...one, status: decision === 'approve' ? 'approved' : 'rejected', version: 2 };
        },
      },
      ACT,
    );
    renderAt('/approvals', client);
    const card = await screen.findByRole('article', { name: 'Beej Bhandar (D-81)' });
    expect(card).toHaveTextContent('New account');
    expect(card).toHaveTextContent('Asked by Suresh Rao');
    // A lone request is decided on its own: nothing to choose.
    expect(screen.queryByRole('checkbox')).toBeNull();

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.type(within(card).getByRole('textbox', { name: /Why are you rejecting it/ }), 'no');
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await within(card).findByText('Say why, in at least 3 characters')).toBeVisible();

    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(writesOf(client).at(-1)).toEqual([
        'POST',
        `/v1/approvals/${FIRST}/decision`,
        expect.anything(),
        { body: { decision: 'approve', version: 1 }, idempotencyKey: expect.any(String) },
      ]),
    );
  });

  it('shows each chain, filters by type, and approves the chosen requests together', async () => {
    const first = request(FIRST, 'Beej Bhandar (D-81)', {
      steps: [
        step({
          status: 'approved',
          actedBy: { id: ASM, code: 'SUN-003', name: 'Meena Shah' },
          actedAt: '2026-10-12T06:00:00.000Z',
          note: 'Known to us',
        }),
        step({ index: 1, approvers: [{ id: ADMIN, code: 'SUN-001', name: 'Anita Rao' }] }),
      ],
    });
    const second = request(SECOND, 'Kisan Seva (D-82)', { version: 3 });
    const move = request(MOVE, 'Green Fields Agro', {
      requestType: 'account_location_change',
      subject: { title: 'Green Fields Agro', accountId: SHOP },
      bulk: false,
    });
    const counts = { new_account: 2, account_location_change: 1 };
    const client = fakeClient(
      {
        '/v1/approvals/inbox': { items: [first, second, move], nextCursor: null, counts },
        '/v1/approvals/inbox?requestType=account_location_change': {
          items: [move],
          nextCursor: null,
          counts,
        },
      },
      {
        'POST /v1/approvals/decisions': () => ({
          results: [
            { id: FIRST, approval: { ...first, status: 'approved' }, error: null },
            {
              id: SECOND,
              approval: null,
              error: { code: 'CONFLICT', message: 'This request changed.' },
            },
          ],
        }),
      },
      ACT,
    );
    renderAt('/approvals', client);
    const card = await screen.findByRole('article', { name: 'Beej Bhandar (D-81)' });
    const chain = within(card).getByRole('list', { name: 'Approval steps' });
    const steps = within(chain).getAllByRole('listitem');
    expect(steps.map((item) => item.querySelector('.ks-title')?.textContent)).toEqual([
      'Asked by Suresh Rao',
      'Approved by Meena Shah',
      'Waiting for Anita Rao',
    ]);
    expect(steps[1]).toHaveTextContent('“Known to us”');

    const types = screen.getByRole('navigation', { name: 'Type of request' });
    expect(within(types).getByRole('link', { name: 'All (3)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(types).getByRole('link', { name: 'New accounts (2)' })).toBeVisible();

    // A location change is decided on its own.
    const located = screen.getByRole('article', { name: 'Green Fields Agro' });
    expect(within(located).queryByRole('checkbox')).toBeNull();

    const user = userEvent.setup();
    const approve = screen.getByRole('button', { name: 'Approve 0 selected' });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Select all 2/ }));
    expect(screen.getByRole('checkbox', { name: 'Select Kisan Seva (D-82)' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Approve 2 selected' }));
    expect(await screen.findByText('Approved 1 request.')).toBeVisible();
    expect(screen.getByText("1 request wasn't approved:")).toBeVisible();
    expect(
      screen.getByText('Kisan Seva (D-82): This changed somewhere else. Refresh and try again.'),
    ).toBeVisible();
    expect(writesOf(client).at(-1)![3]).toEqual({
      body: {
        items: [
          { id: FIRST, version: 1 },
          { id: SECOND, version: 3 },
        ],
      },
      idempotencyKey: expect.any(String),
    });

    await user.click(within(types).getByRole('link', { name: /location \(1\)/ }));
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Beej Bhandar (D-81)' })).toBeNull(),
    );
    expect(screen.getByRole('article', { name: 'Green Fields Agro' })).toBeVisible();
  });

  it('lists what the viewer asked for, and withdraws one nobody has decided', async () => {
    const waiting = request(MINE, 'Krishi Kendra (D-83)', {
      requester: { id: ADMIN, code: 'SUN-001', name: 'Anita Rao' },
      steps: [step({})],
      cancellable: true,
    });
    const done = request(FIRST, 'Beej Bhandar (D-81)', {
      requester: { id: ADMIN, code: 'SUN-001', name: 'Anita Rao' },
      status: 'rejected',
      steps: [
        step({
          status: 'rejected',
          actedBy: { id: ASM, code: 'SUN-003', name: 'Meena Shah' },
          actedAt: '2026-10-12T06:00:00.000Z',
          note: 'Already listed',
        }),
      ],
    });
    const client = fakeClient(
      {
        '/v1/approvals/inbox': { items: [], nextCursor: null, counts: {} },
        '/v1/approvals/mine': { items: [waiting, done], nextCursor: null },
      },
      {
        [`POST /v1/approvals/${MINE}/cancel`]: () => ({
          ...waiting,
          status: 'cancelled',
          cancellable: false,
        }),
      },
      ACT,
    );
    renderAt('/approvals', client);
    expect(await screen.findByText('Nothing waits for you')).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'My requests' }));

    const rejected = await screen.findByRole('article', { name: 'Beej Bhandar (D-81)' });
    expect(rejected).toHaveTextContent('Rejected');
    expect(rejected).toHaveTextContent('Rejected by Meena Shah');
    expect(rejected).toHaveTextContent('“Already listed”');
    expect(within(rejected).queryByRole('button', { name: 'Withdraw' })).toBeNull();

    const open = screen.getByRole('article', { name: 'Krishi Kendra (D-83)' });
    expect(open).toHaveTextContent('Waiting for Meena Shah');
    await user.click(within(open).getByRole('button', { name: 'Withdraw' }));
    const confirm = within(open).getByRole('group', { name: 'Withdraw this request?' });
    await user.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(writesOf(client).at(-1)!.slice(0, 2)).toEqual([
        'POST',
        `/v1/approvals/${MINE}/cancel`,
      ]),
    );
  });
});
