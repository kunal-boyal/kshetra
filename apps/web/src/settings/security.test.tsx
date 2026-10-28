import { screen, waitFor, within } from '@testing-library/react';
import { todayIn } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt } from '../test-support';

/** Security and data (decision D104): the sign-in, keeping and data cards, then the audit log. */

const MONTH = todayIn('Asia/Kolkata').slice(0, 7);

const LOG = {
  [`/v1/audit?period=${MONTH}&limit=50`]: {
    items: [
      {
        id: '01a10000-0000-7000-8000-000000000201',
        actor: { kind: 'user', id: '01a10000-0000-7000-8000-000000000002', name: 'Anita Rao' },
        action: 'user.updated',
        target: {
          type: 'user',
          id: '01a10000-0000-7000-8000-000000000004',
          label: 'Rahul Verma (SUN-004)',
        },
        before: null,
        after: null,
        ip: null,
        deviceId: null,
        supportGrantId: null,
        createdAt: '2026-10-26T05:00:00.000000Z',
      },
    ],
    nextCursor: null,
  },
};

const GRANT = {
  id: '01a10000-0000-7000-8000-0000000000a1',
  tenant: { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders' },
  staff: { id: '01a10000-0000-7000-8000-0000000000a2', name: 'Vendor support' },
  reason: 'Checking a report',
  scope: 'read',
  hours: 2,
  emergency: false,
  status: 'active',
  grantedScope: 'read',
  approvedBy: null,
  startsAt: '2026-10-26T05:00:00.000Z',
  endsAt: '2026-10-26T07:00:00.000Z',
  closedAt: null,
  closedBy: null,
  createdAt: '2026-10-26T04:50:00.000Z',
};

const SSO = {
  connection: {
    protocol: 'oidc',
    issuer: 'https://login.example',
    clientId: 'portal',
    hasClientSecret: true,
    entryPoint: null,
    idpIssuer: null,
    hasIdpCertificate: false,
    domains: ['sunrise.example'],
    domainChecks: [],
    enabled: true,
    enforced: false,
    updatedAt: '2026-10-20T05:00:00.000Z',
  },
  provider: {
    redirectUri: 'https://app.example/auth/v1/sso/sunrise/callback',
    entityId: 'https://app.example/sso/sunrise',
    acsUrl: 'https://app.example/auth/v1/sso/sunrise/acs',
    metadataUrl: 'https://app.example/auth/v1/sso/sunrise/metadata',
  },
};

describe('security and data (decision D104)', () => {
  it('shows sign-in, keeping and data from the settings, then the log with its targets named', async () => {
    renderAt(
      '/settings/security',
      fakeClient({ ...LOG, '/v1/sso': SSO, '/v1/support-grants': { items: [GRANT] } }, {}, [
        'settings.manage',
        'audit.view',
      ]),
    );
    const signIn = await screen.findByRole('region', { name: 'Sign-in' });
    await waitFor(() => expect(within(signIn).getByText('Connected')).toBeVisible());
    expect(within(signIn).getByText('After 12 hours idle, 7 days at most')).toBeVisible();
    expect(within(signIn).getByText('One work phone a person')).toBeVisible();
    const keeping = screen.getByRole('region', { name: 'How long we keep things' });
    expect(within(keeping).getByText('35 days, then archived')).toBeVisible();
    expect(within(keeping).getByText('12 months')).toBeVisible();
    const data = screen.getByRole('region', { name: 'Your data' });
    expect(await within(data).findByText('Open now')).toBeVisible();
    const log = await screen.findByRole('table', { name: 'Entries' });
    expect(within(log).getByText('Rahul Verma (SUN-004)')).toBeVisible();
  });

  it('shows an auditor the log alone', async () => {
    renderAt('/settings/security', fakeClient(LOG, {}, ['audit.view']));
    expect(await screen.findByRole('table', { name: 'Entries' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your data' })).not.toBeInTheDocument();
  });
});
