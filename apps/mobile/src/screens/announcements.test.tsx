import { describe, expect, it, jest } from '@jest/globals';
import type { SessionState } from '@thelamp/api-client';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppProvider, useApp } from '../app-state';
import type { MobileClient } from '../client';
import { LanguageProvider } from '../i18n';
import { Look } from '../look';
import { Announcements } from './announcements';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const TENANT = { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' };

const ANNOUNCEMENTS = {
  items: [
    {
      id: '01a10000-0000-7000-8000-0000000000d1',
      title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
      body: { en: 'Down from 11 pm to midnight.', hi: 'रात 11 से 12 बजे तक बंद।' },
      tone: 'warning',
      endsAt: '2099-10-27T04:00:00.000Z',
    },
  ],
};

function Shown() {
  const { session, restored } = useApp();
  return restored && session ? <Announcements /> : null;
}

describe('announcements on the phone (M22, D93)', () => {
  it('shows what the vendor announces for phones, in the reader’s language, until dismissed', async () => {
    const session: SessionState = {
      tenant: TENANT,
      accessToken: 'a1',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    const request = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ANNOUNCEMENTS);
    const client = { session, restore: jest.fn(async () => session), request };
    await render(
      <LanguageProvider initial="hi">
        <AppProvider
          createClient={() => client as unknown as MobileClient}
          queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Look>
            <Shown />
          </Look>
        </AppProvider>
      </LanguageProvider>,
    );
    expect(await screen.findByText('तय रखरखाव')).toBeOnTheScreen();
    expect(screen.getByText('रात 11 से 12 बजे तक बंद।')).toBeOnTheScreen();
    expect(request).toHaveBeenCalledWith(
      'GET',
      '/v1/announcements?surface=mobile',
      expect.anything(),
    );
    await fireEvent.press(screen.getByRole('button', { name: '“तय रखरखाव” बंद करें' }));
    expect(screen.queryByText('तय रखरखाव')).not.toBeOnTheScreen();
  });
});
