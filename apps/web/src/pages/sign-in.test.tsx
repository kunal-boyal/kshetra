import { ApiError, NetworkError } from '@kshetra/api-client';
import { SETTING_DEFAULTS } from '@kshetra/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const OTHER = { id: '01a10000-0000-7000-8000-000000000009', name: 'Harit Agri Inputs' };
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();
const signedInSession = () => ({
  tokenType: 'Bearer' as const,
  accessToken: 'a1',
  accessTokenExpiresAt: later(),
  refreshTokenExpiresAt: later(),
});

/** A client that answers like the API, without one. */
function fakeClient(verify: () => Promise<unknown>) {
  let session: { tenant: typeof TENANT } | null = null;
  const signIn = () => {
    session = { tenant: TENANT };
  };
  const client = {
    get session() {
      return session;
    },
    requestCode: vi.fn(async () => ({ expiresInSeconds: 300 })),
    verifyCode: vi.fn(async () => {
      const result = (await verify()) as { status: string };
      if (result.status === 'signed_in') signIn();
      return result;
    }),
    selectTenant: vi.fn(async () => {
      signIn();
      return session;
    }),
    switchTenant: vi.fn(),
    signOut: vi.fn(async () => {}),
    restore: vi.fn(async () => session),
    me: vi.fn(async () => ({
      userId: '01a10000-0000-7000-8000-000000000002',
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-001',
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
      scope: 'tenant',
      permissions: ['user.view'],
      deviceId: null,
    })),
    config: vi.fn(async () => ({
      status: 'fresh',
      etag: '"1-role"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [
          {
            key: 'head',
            name: { en: { one: 'Head', other: 'Heads' }, hi: { one: 'प्रमुख', other: 'प्रमुख' } },
            level: 1,
            ranked: false,
          },
        ],
        access: { role: 'tenant_admin', scope: 'tenant', permissions: ['user.view'] },
      },
    })),
  };
  return client;
}

function renderApp(client: ReturnType<typeof fakeClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ client: client as unknown as WebClient, queryClient });
  const memory = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={memory} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

async function enterNumberAndCode(code = '123456') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Mobile number *'), '90000 00001');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await user.type(await screen.findByLabelText('Code *'), code);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('signing in on the web', () => {
  it('sends people who are signed out to sign in, then home once they are in', async () => {
    const client = fakeClient(async () => ({
      status: 'signed_in',
      tenant: TENANT,
      session: signedInSession(),
    }));
    renderApp(client);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await enterNumberAndCode();
    expect(client.requestCode).toHaveBeenCalledWith('90000 00001');
    expect(client.verifyCode).toHaveBeenCalledWith('90000 00001', '123456');
    expect(await screen.findByRole('heading', { name: 'Hello, Anita Rao' })).toBeInTheDocument();
    expect(screen.getByText('Head at Sunrise Traders')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument();
  });

  it('lets a person in two organisations choose one after the code', async () => {
    const client = fakeClient(async () => ({
      status: 'choose_tenant',
      ticket: 't'.repeat(43),
      tenants: [{ id: TENANT.id, name: TENANT.name }, OTHER],
    }));
    renderApp(client);
    const user = await enterNumberAndCode();
    expect(await screen.findByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Sunrise Traders/ }));
    expect(client.selectTenant).toHaveBeenCalledWith('t'.repeat(43), TENANT.id);
    expect(await screen.findByRole('heading', { name: 'Hello, Anita Rao' })).toBeInTheDocument();
  });

  it('says what went wrong, in the chosen language', async () => {
    const client = fakeClient(async () => {
      throw new ApiError(400, 'OTP_INVALID', 'That code is not right.');
    });
    renderApp(client);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), 'hi');
    await user.type(await screen.findByLabelText('मोबाइल नंबर *'), '9000000001');
    await user.click(screen.getByRole('button', { name: 'कोड भेजें' }));
    await user.type(await screen.findByLabelText('कोड *'), '000000');
    await user.click(screen.getByRole('button', { name: 'साइन इन करें' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'यह कोड सही नहीं है। जाँचकर फिर कोशिश करें।',
    );
  });

  it('says so when signing out could not reach the server, and stays signed in', async () => {
    const client = fakeClient(async () => ({
      status: 'signed_in',
      tenant: TENANT,
      session: signedInSession(),
    }));
    client.signOut.mockRejectedValueOnce(new NetworkError(new TypeError('Failed to fetch')));
    renderApp(client);
    const user = await enterNumberAndCode();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server could not be reached. Check your connection, then try again.',
    );
    expect(screen.getByRole('heading', { name: 'Hello, Anita Rao' })).toBeInTheDocument();
  });

  it('tells a field user on the web to use the mobile app', async () => {
    const client = fakeClient(async () => {
      throw new ApiError(403, 'USE_MOBILE_APP', 'Use the mobile app to sign in.');
    });
    renderApp(client);
    await enterNumberAndCode();
    expect(await screen.findByRole('alert')).toHaveTextContent('Use the mobile app for this.');
  });
});
