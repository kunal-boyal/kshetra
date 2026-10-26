import { ApiError } from '@thelamp/api-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, type RequestOptions, writesOf } from '../test-support';

const PROVIDER = {
  redirectUri: 'http://127.0.0.1:3000/auth/v1/sso/sunrise/oidc/callback',
  entityId: 'http://127.0.0.1:3000/auth/v1/sso/sunrise/saml/metadata',
  acsUrl: 'http://127.0.0.1:3000/auth/v1/sso/sunrise/saml/acs',
  metadataUrl: 'http://127.0.0.1:3000/auth/v1/sso/sunrise/saml/metadata',
};

const OIDC = {
  protocol: 'oidc',
  issuer: 'https://login.sunrise.example',
  clientId: 'thelamp-portal',
  hasClientSecret: true,
  entryPoint: null,
  idpIssuer: null,
  hasIdpCertificate: false,
  domains: ['sunrise.example'],
  domainChecks: [
    {
      domain: 'sunrise.example',
      verified: true,
      recordName: '_thelamp-sso.sunrise.example',
      recordValue: 'thelamp-sso=0123456789abcdef0123456789abcdef',
    },
  ],
  enabled: true,
  enforced: false,
  updatedAt: '2026-10-25T06:00:00.000Z',
};

/** Each domain as the API answers it: proved only once its record is checked (D101). */
const checksOf = (domains: string[], verified: string[] = []) =>
  domains.map((domain) => ({
    domain,
    verified: verified.includes(domain),
    recordName: `_thelamp-sso.${domain}`,
    recordValue: `thelamp-sso=${'0'.repeat(32)}`,
  }));

const CERTIFICATE = `-----BEGIN CERTIFICATE-----\n${'MIIC'.repeat(40)}\n-----END CERTIFICATE-----`;

/** A client whose PUT keeps what it was sent, as the API does, without the secrets. */
function ssoClient(connection: object | null) {
  let current: { connection: object | null; provider: typeof PROVIDER } = {
    connection,
    provider: PROVIDER,
  };
  return fakeClient(
    { '/v1/sso': () => current },
    {
      'POST /v1/sso/domains/verify': ({ body }: RequestOptions) => {
        const { domain } = body as { domain: string };
        if (domain === 'sunrise-agro.example') {
          throw new ApiError(400, 'VALIDATION', 'Check the fields.', [
            {
              path: 'domain',
              issue:
                'No TXT record with the token was found at _thelamp-sso.sunrise-agro.example yet',
            },
          ]);
        }
        return current;
      },
      'PUT /v1/sso': ({ body }: RequestOptions) => {
        const { settings, ...rest } = body as {
          settings: Record<string, string>;
          domains: string[];
          enabled: boolean;
          enforced: boolean;
        };
        if (rest.domains.includes('bad')) {
          throw new ApiError(400, 'VALIDATION', 'Check the fields.', [
            { path: 'domains.0', issue: 'Enter a domain such as example.com' },
          ]);
        }
        const saml = settings.protocol === 'saml';
        current = {
          provider: PROVIDER,
          connection: {
            protocol: settings.protocol,
            issuer: settings.issuer ?? null,
            clientId: settings.clientId ?? null,
            hasClientSecret: !saml,
            entryPoint: settings.entryPoint ?? null,
            idpIssuer: settings.idpIssuer ?? null,
            hasIdpCertificate: saml,
            ...rest,
            domainChecks: checksOf(rest.domains, ['sunrise.example']),
            updatedAt: '2026-10-25T07:00:00.000Z',
          },
        };
        return current;
      },
    },
    ['settings.manage'],
  );
}

describe('single sign-on settings (spec M1, D91)', () => {
  it('shows what the identity provider needs, with a way to copy each', async () => {
    renderAt('/settings/sso', ssoClient(null));
    const provider = await screen.findByRole('region', { name: 'For your identity provider' });
    expect(within(provider).getByText(PROVIDER.redirectUri)).toBeVisible();
    expect(within(provider).getByText(PROVIDER.acsUrl)).toBeVisible();
    expect(
      within(provider).getByRole('button', { name: 'Copy Redirect URI (OIDC)' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Single sign-on' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the saved secret when it is left blank, and turns the connection on and required', async () => {
    const client = ssoClient(OIDC);
    renderAt('/settings/sso', client);
    const user = userEvent.setup();
    const secret = await screen.findByLabelText('Client secret');
    expect(secret).toHaveValue('');
    expect(screen.getByText('Saved. Leave it blank to keep it.')).toBeVisible();
    expect(screen.getByLabelText('Email domains *')).toHaveValue('sunrise.example');
    await user.type(screen.getByLabelText('Email domains *'), '\nSunrise-Agro.example');
    await user.click(screen.getByRole('checkbox', { name: /Required/ }));
    await user.click(screen.getByRole('button', { name: 'Save single sign-on' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe('/v1/sso');
    expect((options as RequestOptions).body).toEqual({
      settings: {
        protocol: 'oidc',
        issuer: 'https://login.sunrise.example',
        clientId: 'thelamp-portal',
      },
      domains: ['sunrise.example', 'sunrise-agro.example'],
      enabled: true,
      enforced: true,
    });

    // The new domain waits for its TXT record; checking too early says so (D101).
    const proofs = await screen.findByRole('region', { name: 'Prove your domains' });
    expect(within(proofs).getByText('_thelamp-sso.sunrise-agro.example')).toBeVisible();
    expect(within(proofs).getAllByText('Not verified yet')).toHaveLength(1);
    await user.click(within(proofs).getByRole('button', { name: 'Check now' }));
    expect(
      await within(proofs).findByText(
        'No TXT record with the token was found at _thelamp-sso.sunrise-agro.example yet',
      ),
    ).toBeVisible();
  });

  it('sets up SAML with a certificate, and shows a domain the API refused', async () => {
    const client = ssoClient(null);
    renderAt('/settings/sso', client);
    const user = userEvent.setup();
    expect(await screen.findByRole('checkbox', { name: /Required/ })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Protocol'), 'saml');
    await user.type(screen.getByLabelText('Sign-in URL *'), 'https://idp.sunrise.example/sso');
    await user.type(screen.getByLabelText('Provider’s entity ID *'), 'https://idp.sunrise.example');
    await user.click(screen.getByLabelText('Signing certificate *'));
    await user.paste(CERTIFICATE);
    await user.type(screen.getByLabelText('Email domains *'), 'bad');
    await user.click(screen.getByRole('checkbox', { name: /On/ }));
    await user.click(screen.getByRole('button', { name: 'Save single sign-on' }));
    expect(await screen.findByText('Enter a domain such as example.com')).toBeVisible();

    await user.clear(screen.getByLabelText('Email domains *'));
    await user.type(screen.getByLabelText('Email domains *'), 'sunrise.example');
    await user.click(screen.getByRole('button', { name: 'Save single sign-on' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    const body = (writesOf(client).at(-1)![3] as RequestOptions).body as {
      settings: Record<string, string>;
    };
    expect(body.settings).toEqual({
      protocol: 'saml',
      entryPoint: 'https://idp.sunrise.example/sso',
      idpIssuer: 'https://idp.sunrise.example',
      idpCertificate: CERTIFICATE,
    });
    // Saved, the certificate field empties and says the saved one is kept.
    expect(screen.getByLabelText('Signing certificate')).toHaveValue('');
    expect(screen.getByText('Saved. Leave it blank to keep it.')).toBeVisible();
  });
});
