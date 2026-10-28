import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const ERP = {
  id: '01a10000-0000-7000-8000-0000000000e1',
  name: 'Tally ERP',
  clientId: '01a1000000007000800000000000000.k3j9x2',
  scopes: ['people:read', 'accounts:write'],
  status: 'active' as const,
  createdAt: '2026-10-20T05:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

/** A fictional secret, as the API shows it once. */
const SECRET = 'test-secret-shown-once';

function clientsClient(items: object[]) {
  let current = items;
  return fakeClient(
    { '/v1/api-clients': () => ({ items: current }) },
    {
      'POST /v1/api-clients': ({ body }: RequestOptions) => {
        const made = {
          ...ERP,
          ...(body as { id: string; name: string; scopes: string[] }),
          clientId: 'made.client',
        };
        current = [...current, made];
        return { client: made, clientSecret: SECRET };
      },
      [`POST /v1/api-clients/${ERP.id}/rotate`]: () => ({
        client: ERP,
        clientSecret: `${SECRET}-2`,
      }),
      [`POST /v1/api-clients/${ERP.id}/revoke`]: () => {
        current = current.map((item) => ({ ...item, status: 'revoked' }));
        return current[0];
      },
    },
    ['api_client.manage'],
  );
}

describe('API clients in Settings (M20, D94)', () => {
  it('lists clients with their scopes and shows where to connect', async () => {
    renderAt('/settings/api-clients', clientsClient([ERP]));
    const list = await screen.findByRole('table', { name: 'Your API clients' });
    const row = within(list).getByRole('row', { name: /Tally ERP/ });
    expect(row).toHaveTextContent('People: Read, Accounts: Write');
    expect(row).toHaveTextContent('Never');
    const connecting = screen.getByRole('region', { name: 'Connecting' });
    expect(within(connecting).getByText(/\/auth\/v1\/oauth\/token$/)).toBeVisible();
    expect(
      within(connecting).getByRole('link', { name: 'Open the API reference' }),
    ).toHaveAttribute('href', expect.stringMatching(/\/v1\/docs$/));
    // The old address opens the Developers page, its group marked.
    expect(screen.getByRole('heading', { level: 1, name: 'API and webhooks' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Developers' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Create a key' })).toHaveAttribute('href', '#new-key');
  });

  it('makes a client with the chosen scopes and shows its secret once', async () => {
    const client = clientsClient([]);
    renderAt('/settings/api-clients', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('region', { name: 'New API client' });
    await user.type(within(form).getByLabelText(/^Name/), 'HR sync');
    await user.click(within(form).getByRole('button', { name: 'Add API client' }));
    expect(within(form).getByText('Choose at least one scope')).toBeVisible();
    expect(writesOf(client)).toEqual([]);

    await user.click(within(form).getByRole('checkbox', { name: 'Metric values: Write' }));
    await user.click(within(form).getByRole('checkbox', { name: 'People: Write' }));
    await user.click(within(form).getByRole('button', { name: 'Add API client' }));
    const shown = await screen.findByRole('region', { name: 'Credentials for HR sync' });
    expect(within(shown).getByText(SECRET)).toBeVisible();
    expect(within(shown).getByText('made.client')).toBeVisible();
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe('/v1/api-clients');
    // Scopes go in the API's own order.
    expect((options as RequestOptions).body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'HR sync',
      scopes: ['people:write', 'metrics:write'],
    });
    expect(
      await screen.findByRole('row', { name: /HR sync/ }, { timeout: 2000 }),
    ).toBeInTheDocument();

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('gives a new secret and revokes only after asking', async () => {
    const client = clientsClient([ERP]);
    renderAt('/settings/api-clients', client);
    const user = userEvent.setup();
    const row = await screen.findByRole('row', { name: /Tally ERP/ });
    await user.click(within(row).getByRole('button', { name: 'New secret' }));
    expect(
      within(row).getByText(
        'Give Tally ERP a new secret? The old one and its tokens stop working at once.',
      ),
    ).toBeVisible();
    expect(writesOf(client)).toEqual([]);
    await user.click(within(row).getByRole('button', { name: 'New secret' }));
    expect(await screen.findByText(`${SECRET}-2`)).toBeVisible();

    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(row).toHaveTextContent('Revoked'));
    expect(writesOf(client).map(([, path]) => path)).toEqual([
      `/v1/api-clients/${ERP.id}/rotate`,
      `/v1/api-clients/${ERP.id}/revoke`,
    ]);
  });
});
