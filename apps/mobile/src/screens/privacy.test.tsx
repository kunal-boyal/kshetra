import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { claim, migrate } from '@thelamp/api-client/sync';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { SyncProvider } from '../sync';
import { PrivacyScreen } from './privacy';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const POLICY = 'https://sunrise.example/privacy';

function fakeClient(signedIn: boolean) {
  const session: SessionState | null = signedIn
    ? {
        tenant: TENANT,
        accessToken: 'a1',
        accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }
    : null;
  const client = {
    session,
    owner: `${TENANT.id}:01a10000-0000-7000-8000-000000000004`,
    restore: jest.fn(async () => session),
    config: jest.fn(async () => ({
      status: 'fresh',
      etag: '"1-role-4"',
      bundle: {
        version: 1,
        settings: { ...SETTING_DEFAULTS, privacyPolicyUrl: POLICY },
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'field_user', scope: 'self', permissions: [] },
      },
    })),
  };
  return { client, create: () => client as unknown as MobileClient };
}

function Shown() {
  const { restored } = useApp();
  return restored ? <PrivacyScreen /> : null;
}

async function renderPhone(signedIn: boolean) {
  const fake = fakeClient(signedIn);
  const db = nodeSqlite();
  await migrate(db);
  await claim(db, fake.client.owner);
  await render(
    <LanguageProvider initial="en">
      <AppProvider
        createClient={fake.create}
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
        }
      >
        <SyncProvider openDatabase={async () => db}>
          <Look>
            <Shown />
          </Look>
        </SyncProvider>
      </AppProvider>
    </LanguageProvider>,
  );
  return fake.client;
}

describe('the privacy notice on the phone (spec 13.3, D100)', () => {
  it('shows the notice, and the organisation’s own policy once signed in', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderPhone(true);
    expect(await screen.findByRole('heading', { name: 'Privacy notice' })).toBeOnTheScreen();
    expect(screen.getByRole('heading', { name: 'What is never recorded' })).toBeOnTheScreen();
    expect(
      screen.getByText(/only while you are on duty: from punch-in to punch-out/),
    ).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText('Your organisation’s privacy policy'));
    expect(open).toHaveBeenCalledWith(POLICY);
  });

  it('can be read before signing in, without the organisation’s link', async () => {
    const client = await renderPhone(false);
    expect(await screen.findByRole('heading', { name: 'Privacy notice' })).toBeOnTheScreen();
    expect(screen.getByText(/The Lamp is a work app your organisation uses/)).toBeOnTheScreen();
    expect(screen.queryByText('Your organisation’s privacy policy')).toBeNull();
    expect(client.config).not.toHaveBeenCalled();
  });
});
