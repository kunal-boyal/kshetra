import { describe, expect, it, jest } from '@jest/globals';
import { ApiError, NetworkError, type SessionState } from '@thelamp/api-client';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppProvider, useApp } from '../app-state';
import type { ClientEvents, MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { HomeScreen } from './home';
import { MeScreen } from './me';
import { SignInScreen } from './sign-in';
import { UpdateRequiredScreen } from './update-required';

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };
const later = () => new Date(Date.now() + 15 * 60_000).toISOString();

/** A client that answers like the API, without one, and raises the client's events. */
function fakeClient(verify: (events: ClientEvents) => Promise<unknown>) {
  let session: SessionState | null = null;
  let events: ClientEvents;
  const signIn = () => {
    session = { tenant: TENANT, accessToken: 'a1', accessTokenExpiresAt: later() };
  };
  const client = {
    get session() {
      return session;
    },
    restore: jest.fn(async () => session),
    requestCode: jest.fn(async () => ({ expiresInSeconds: 300 })),
    verifyCode: jest.fn(async () => {
      const result = (await verify(events)) as { status: string };
      if (result.status === 'signed_in') signIn();
      return result;
    }),
    signOut: jest.fn(async () => {
      session = null;
      events.onSignedOut();
    }),
    me: jest.fn(async () => ({
      userId: '01a10000-0000-7000-8000-000000000002',
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-001',
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
      scope: 'tenant',
      permissions: ['user.view'],
      deviceId: '01a10000-0000-7000-8000-000000000003',
    })),
    config: jest.fn(async () => ({
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
        access: {
          role: 'tenant_admin',
          scope: 'tenant',
          permissions: ['user.view', 'account.view'],
        },
      },
    })),
  };
  return {
    client,
    create: (given: ClientEvents) => {
      events = given;
      return client as unknown as MobileClient;
    },
  };
}

/** What the router's guards do: sign-in while signed out, the app once signed in. */
function Gate({ signedIn }: { signedIn: 'home' | 'me' }) {
  const { session, restored, upgradeRequired } = useApp();
  if (!restored) return null;
  if (upgradeRequired) return <UpdateRequiredScreen />;
  if (!session) return <SignInScreen />;
  return signedIn === 'home' ? <HomeScreen /> : <MeScreen />;
}

async function renderApp(fake: ReturnType<typeof fakeClient>, signedIn: 'home' | 'me' = 'home') {
  await render(
    <LanguageProvider initial="en">
      <AppProvider
        createClient={fake.create}
        // No cache timers outlive the test.
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
        }
      >
        <Look>
          <Gate signedIn={signedIn} />
        </Look>
      </AppProvider>
    </LanguageProvider>,
  );
}

async function enterNumberAndCode(code = '123456') {
  await fireEvent.changeText(await screen.findByLabelText('Mobile number *'), '90000 00001');
  await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
  // The code's label names the number it went to, masked.
  await fireEvent.changeText(
    await screen.findByLabelText(/^Code sent by SMS to \+91•+\d{5}$/),
    code,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

const signedIn = () => ({
  status: 'signed_in',
  tenant: TENANT,
  session: {
    tokenType: 'Bearer',
    accessToken: 'a1',
    accessTokenExpiresAt: later(),
    refreshToken: 'r'.repeat(43),
    refreshTokenExpiresAt: later(),
  },
});

describe('signing in on a phone', () => {
  it('goes from the number and code to home, in the tenant’s words', async () => {
    const fake = fakeClient(async () => signedIn());
    await renderApp(fake);
    expect(
      await screen.findByRole('heading', { name: 'Light the way for your field team' }),
    ).toBeOnTheScreen();
    expect(screen.getByText(/This phone becomes your work phone/)).toBeOnTheScreen();
    await enterNumberAndCode();
    // The field keeps the ten digits, whatever spacing was typed (decision D102).
    expect(fake.client.requestCode).toHaveBeenCalledWith('9000000001');
    expect(fake.client.verifyCode).toHaveBeenCalledWith('9000000001', '123456');
    expect(await screen.findByText(/^Good (morning|afternoon|evening), Anita$/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeOnTheScreen();
  });

  it('asks for a 10-digit mobile number before sending anything (decision D102)', async () => {
    const fake = fakeClient(async () => signedIn());
    await renderApp(fake);
    const field = await screen.findByLabelText('Mobile number *');
    await fireEvent.changeText(field, '+91 98765');
    expect(field).toHaveDisplayValue('9198765');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter all 10 digits of the mobile number')).toBeOnTheScreen();
    await fireEvent.changeText(field, '1123456789');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('A mobile number starts with 6, 7, 8 or 9')).toBeOnTheScreen();
    expect(fake.client.requestCode).not.toHaveBeenCalled();
  });

  it('shows the number the code went to masked, waits before a resend, and goes back to change it', async () => {
    const fake = fakeClient(async () => signedIn());
    await renderApp(fake);
    await fireEvent.changeText(await screen.findByLabelText('Mobile number *'), '90000 00001');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByLabelText('Code sent by SMS to +91•••••00001')).toBeOnTheScreen();
    expect(screen.queryByText(/9000000001|90000 00001/)).toBeNull();
    expect(screen.getByText('You can ask for a new code in 30 seconds.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Send a new code' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Use a different number' }));
    expect(await screen.findByLabelText('Mobile number *')).toHaveProp('value', '9000000001');
    expect(fake.client.requestCode).toHaveBeenCalledTimes(1);
  });

  it('says what went wrong, in the chosen language', async () => {
    const fake = fakeClient(async () => {
      throw new ApiError(400, 'OTP_INVALID', 'That code is not right.');
    });
    await renderApp(fake);
    await fireEvent.press(await screen.findByRole('button', { name: 'हिन्दी' }));
    await fireEvent.changeText(await screen.findByLabelText('मोबाइल नंबर *'), '9000000001');
    await fireEvent.press(screen.getByRole('button', { name: 'कोड भेजें' }));
    const code = await screen.findByLabelText(/पर SMS से भेजा गया कोड$/);
    await fireEvent.changeText(code, '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'साइन इन करें' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'यह कोड सही नहीं है। जाँचकर फिर कोशिश करें।',
    );
    // The boxes keep the digits under the error, so one wrong digit is fixed in place.
    expect(code).toHaveProp('value', '000000');
    expect(code).toHaveProp('aria-invalid', true);
  });

  it('tells a person whose phone is not linked to ask their manager', async () => {
    const fake = fakeClient(async () => {
      throw new ApiError(409, 'DEVICE_NOT_BOUND', 'Not this phone.');
    });
    await renderApp(fake);
    await enterNumberAndCode();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This phone is not registered for your account. Ask your manager to reset your device.',
    );
  });

  it('says when there is no network', async () => {
    const fake = fakeClient(async () => {
      throw new NetworkError(new TypeError('Network request failed'));
    });
    await renderApp(fake);
    await enterNumberAndCode();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server could not be reached. Check your connection, then try again.',
    );
  });

  it('shows only the update screen once the API turns this version away', async () => {
    const fake = fakeClient(async (events) => {
      events.onUpgradeRequired();
      throw new ApiError(426, 'UPGRADE_REQUIRED', 'Update.');
    });
    await renderApp(fake);
    await enterNumberAndCode();
    expect(await screen.findByText('Update the app')).toBeOnTheScreen();
    expect(screen.queryByText('Light the way for your field team')).toBeNull();
  });
});

describe('Me', () => {
  it('chooses the display, and signs out back to sign-in', async () => {
    const fake = fakeClient(async () => signedIn());
    await renderApp(fake, 'me');
    await enterNumberAndCode();
    // More holds the work with no tab of its own (D104): accounts here, forms only with filling.
    expect(await screen.findByRole('heading', { name: 'More' })).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: 'Accounts' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Forms' })).toBeNull();
    const outdoor = await screen.findByRole('radio', { name: 'Outdoor' });
    await fireEvent.press(outdoor);
    expect(screen.getByRole('radio', { name: 'Outdoor' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(fake.client.signOut).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('heading', { name: 'Light the way for your field team' }),
    ).toBeOnTheScreen();
  });
});
