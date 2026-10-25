import { ApiError, NetworkError } from '@thelamp/api-client';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';
import { browser } from './sign-in';

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
    totpSetup: vi.fn(async () => ({
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      uri: 'otpauth://totp/The%20Lamp:x?secret=JBSWY3DPEHPK3PXP',
    })),
    totpVerify: vi.fn(
      async (
        _ticket: string,
        answer: { code: string } | { recoveryCode: string },
      ): Promise<{ status: 'signed_in'; recoveryCodes?: string[] }> => {
        if ('code' in answer && answer.code === '000000') {
          throw new ApiError(400, 'OTP_INVALID', 'Check the code.');
        }
        signIn();
        return 'code' in answer && answer.code === '111111'
          ? { status: 'signed_in', recoveryCodes: ['K7Q2M-XW4PA', 'ZZ2AB-CD3EF'] }
          : { status: 'signed_in' };
      },
    ),
    ssoDiscover: vi.fn(async (email: string) =>
      email.endsWith('@sunrise.example') ? 'http://127.0.0.1:3000/auth/v1/sso/sunrise/start' : null,
    ),
    switchTenant: vi.fn(),
    signOut: vi.fn(async () => {}),
    restore: vi.fn(async () => session),
    // The home reads its dashboard; anything else is not part of signing in.
    request: vi.fn(async (_method: string, path: string) => {
      if (path.startsWith('/v1/dashboard')) {
        return {
          period: path.slice(-7),
          view: 'self',
          people: 1,
          tiles: [],
          trend: [],
          mix: [],
          leaderboard: null,
          onDuty: null,
          waiting: { reviews: null, approvals: null },
        };
      }
      throw new Error(`Nothing at ${path}`);
    }),
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

  it('sets up an authenticator for someone who can change access, and shows the recovery codes once', async () => {
    const client = fakeClient(async () => ({
      status: 'second_factor',
      ticket: 's'.repeat(43),
      enrolled: false,
      tenant: { id: TENANT.id, name: TENANT.name },
    }));
    renderApp(client);
    const user = await enterNumberAndCode();
    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
    expect(screen.getByText(/You can change who does what in Sunrise Traders/)).toBeVisible();
    expect(
      await screen.findByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await user.type(screen.getByLabelText('Authenticator code *'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    expect(
      await screen.findByText('That code is not right. Check it and try again.'),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Authenticator code *'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    const codes = await screen.findByRole('list', { name: 'Your recovery codes' });
    expect(codes).toHaveTextContent('K7Q2M-XW4PA');
    await user.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Anita Rao' })).toBeInTheDocument();
    expect(client.totpVerify).toHaveBeenLastCalledWith('s'.repeat(43), { code: '111111' });
  });

  it('signs in with a recovery code instead of the authenticator', async () => {
    const client = fakeClient(async () => ({
      status: 'second_factor',
      ticket: 's'.repeat(43),
      enrolled: true,
      tenant: { id: TENANT.id, name: TENANT.name },
    }));
    renderApp(client);
    const user = await enterNumberAndCode();
    expect(
      await screen.findByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeVisible();
    expect(client.totpSetup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText('Recovery code *'), 'k7q2m-xw4pa');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Anita Rao' })).toBeInTheDocument();
    expect(client.totpVerify).toHaveBeenCalledWith('s'.repeat(43), { recoveryCode: 'K7Q2M-XW4PA' });
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

describe('signing in with single sign-on (decision D91)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('finds the organisation from a work email and sends the browser to its sign-in', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {});
    const client = fakeClient(async () => ({}));
    renderApp(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in with SSO' }));
    expect(screen.getByRole('heading', { name: 'Sign in with your organisation' })).toBeVisible();
    const proceed = screen.getByRole('button', { name: 'Continue' });
    expect(proceed).toBeDisabled();
    await user.type(screen.getByLabelText('Work email *'), 'someone@elsewhere.example');
    await user.click(proceed);
    expect(await screen.findByText(/doesn’t use single sign-on for this email/)).toBeVisible();
    expect(go).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Work email *'));
    await user.type(screen.getByLabelText('Work email *'), 'anita@sunrise.example');
    await user.click(proceed);
    expect(client.ssoDiscover).toHaveBeenLastCalledWith('anita@sunrise.example');
    expect(go).toHaveBeenCalledWith('http://127.0.0.1:3000/auth/v1/sso/sunrise/start');
    await user.click(screen.getByRole('button', { name: 'Sign in with your mobile number' }));
    expect(await screen.findByLabelText('Mobile number *')).toBeVisible();
  });

  it('says why a single sign-on came back without signing in', async () => {
    window.history.replaceState({}, '', '/sign-in?sso=no_person');
    renderApp(fakeClient(async () => ({})));
    expect(
      await screen.findByRole('heading', { name: 'Sign in with your organisation' }),
    ).toBeVisible();
    expect(screen.getByText(/Nobody here has that work email/)).toBeVisible();
  });

  it('says when a vendor support link from the console expired or was used', async () => {
    window.history.replaceState({}, '', '/sign-in?support=expired');
    renderApp(fakeClient(async () => ({})));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That support link has expired or was already used. Open the portal again from the console.',
    );
    expect(screen.getByLabelText('Mobile number *')).toBeVisible();
  });

  it('moves to single sign-on when the organisation requires it', async () => {
    const client = fakeClient(async () => {
      throw new ApiError(403, 'SSO_REQUIRED', 'Sign in with SSO.');
    });
    renderApp(client);
    await enterNumberAndCode();
    expect(
      await screen.findByRole('heading', { name: 'Sign in with your organisation' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Work email *')).toBeVisible();
  });
});
