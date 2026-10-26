import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const HOOK = {
  id: '01a10000-0000-7000-8000-0000000000e5',
  url: 'https://erp.sunrise.example/hooks',
  events: ['account.created', 'order.placed'],
  description: 'Tally ERP',
  status: 'active' as const,
  createdAt: '2026-10-20T05:00:00.000Z',
  lastDelivery: null,
};

/** A fictional signing secret, as the API shows it once. */
const SECRET = 'whsec_dGVzdC1vbmx5';

const delivery = (n: number, change: object = {}) => ({
  id: `01a10000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  messageId: `01a10000-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`,
  event: 'order.placed',
  eventId: `01a10000-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`,
  attempt: 1,
  status: 'delivered',
  responseCode: 200,
  durationMs: 80,
  error: null,
  messageStatus: 'delivered',
  createdAt: '2026-10-26T04:00:00.000Z',
  ...change,
});

const LOG = `/v1/webhooks/${HOOK.id}/deliveries`;

function hooksClient(items: object[]) {
  let current = items;
  const patch = (body: object) => {
    current = current.map((item) => ({ ...item, ...body }));
    return current[0];
  };
  return fakeClient(
    {
      '/v1/webhooks': () => ({ items: current }),
      [`${LOG}?limit=20`]: {
        items: [delivery(1, { status: 'failed', responseCode: 503, messageStatus: 'failed' })],
        nextCursor: 'c1',
      },
      [`${LOG}?limit=20&cursor=c1`]: { items: [delivery(2)], nextCursor: null },
    },
    {
      'POST /v1/webhooks': ({ body }: RequestOptions) => {
        const made = { ...HOOK, description: null, ...(body as object) };
        current = [...current, made];
        return { webhook: made, secret: SECRET };
      },
      [`PATCH /v1/webhooks/${HOOK.id}`]: ({ body }: RequestOptions) => patch(body as object),
      [`POST /v1/webhooks/${HOOK.id}/test`]: () =>
        delivery(9, { event: 'webhook.test', eventId: null, durationMs: 42 }),
      [`POST /v1/webhooks/${HOOK.id}/rotate`]: () => ({ webhook: HOOK, secret: `${SECRET}2` }),
      [`POST /v1/webhooks/${HOOK.id}/messages/${delivery(1).messageId}/replay`]: () => ({
        queued: true,
      }),
    },
    ['webhook.manage'],
  );
}

describe('webhooks in Settings (M20, D94)', () => {
  it('adds a webhook for chosen events and shows its secret once', async () => {
    const client = hooksClient([]);
    renderAt('/settings/webhooks', client);
    const user = userEvent.setup();
    expect(await screen.findByText('No webhooks yet.')).toBeVisible();
    const form = screen.getByRole('region', { name: 'New webhook' });
    await user.type(within(form).getByLabelText(/^Address/), 'https://hr.sunrise.example/events');
    await user.click(within(form).getByRole('button', { name: 'Add webhook' }));
    expect(within(form).getByText('Choose at least one event')).toBeVisible();
    expect(writesOf(client)).toEqual([]);

    await user.click(within(form).getByRole('checkbox', { name: /Person deactivated/ }));
    await user.click(within(form).getByRole('checkbox', { name: /Person added/ }));
    await user.click(within(form).getByRole('button', { name: 'Add webhook' }));
    const shown = await screen.findByRole('region', {
      name: 'Signing secret for https://hr.sunrise.example/events',
    });
    expect(within(shown).getByText(SECRET)).toBeVisible();
    expect((writesOf(client)[0]![3] as RequestOptions).body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      url: 'https://hr.sunrise.example/events',
      events: ['user.created', 'user.deactivated'],
    });
    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('sends a test, pauses, and changes the events', async () => {
    const client = hooksClient([HOOK]);
    renderAt('/settings/webhooks', client);
    const user = userEvent.setup();
    const hook = await screen.findByRole('article', { name: HOOK.url });
    expect(hook).toHaveTextContent('Account added, Order placed');
    expect(hook).toHaveTextContent('Nothing sent yet');

    await user.click(within(hook).getByRole('button', { name: 'Send a test' }));
    expect(await within(hook).findByRole('status')).toHaveTextContent(
      'Delivered: your system answered 200 in 42 ms.',
    );

    await user.click(within(hook).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(hook).toHaveTextContent('Paused: nothing is sent'));
    expect(within(hook).getByRole('button', { name: 'Send a test' })).toBeDisabled();

    await user.click(within(hook).getByRole('button', { name: 'Change' }));
    await user.click(within(hook).getByRole('checkbox', { name: /Order placed/ }));
    await user.click(within(hook).getByRole('button', { name: 'Save webhook' }));
    await waitFor(() => expect(hook).toHaveTextContent(/Account added(?!, Order placed)/));
    const writes = writesOf(client).map(([method, path, , options]) => [
      method,
      path,
      (options as RequestOptions).body,
    ]);
    expect(writes).toEqual([
      ['POST', `/v1/webhooks/${HOOK.id}/test`, undefined],
      ['PATCH', `/v1/webhooks/${HOOK.id}`, { status: 'paused' }],
      [
        'PATCH',
        `/v1/webhooks/${HOOK.id}`,
        { url: HOOK.url, events: ['account.created'], description: 'Tally ERP' },
      ],
    ]);
  });

  it('reads the delivery log a page at a time and sends a message again', async () => {
    const client = hooksClient([HOOK]);
    renderAt('/settings/webhooks', client);
    const user = userEvent.setup();
    const hook = await screen.findByRole('article', { name: HOOK.url });
    await user.click(within(hook).getByText('Delivery log'));
    const log = await within(hook).findByRole('table', { name: 'Delivery log' });
    expect(within(log).getAllByRole('row')).toHaveLength(2);
    expect(log).toHaveTextContent('Not delivered · 503');
    expect(log).toHaveTextContent('Given up');
    await user.click(within(hook).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(log).getAllByRole('row')).toHaveLength(3));

    const failed = within(log).getAllByRole('row')[1]!;
    await user.click(within(failed).getByRole('button', { name: 'Send again' }));
    expect(await within(failed).findByText('Queued')).toBeVisible();
    expect(writesOf(client).map(([, path]) => path)).toEqual([
      `/v1/webhooks/${HOOK.id}/messages/${delivery(1).messageId}/replay`,
    ]);
  });

  it('gives a new secret only after asking', async () => {
    const client = hooksClient([HOOK]);
    renderAt('/settings/webhooks', client);
    const user = userEvent.setup();
    const hook = await screen.findByRole('article', { name: HOOK.url });
    await user.click(within(hook).getByRole('button', { name: 'New secret' }));
    expect(writesOf(client)).toEqual([]);
    await user.click(within(hook).getByRole('button', { name: 'New secret' }));
    expect(await screen.findByText(`${SECRET}2`)).toBeVisible();
  });
});
