import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { LanguageProvider } from '../i18n';
import { storeUrl, UpdateRequiredScreen } from './update-required';

const PLAY = 'https://play.google.com/store/apps/details?id=in.example.app';

afterEach(() => {
  delete process.env.EXPO_PUBLIC_PLAY_STORE_URL;
  delete process.env.EXPO_PUBLIC_APP_STORE_URL;
});

describe('the update screen (M1, rule 8)', () => {
  it('opens the store page the build carries', async () => {
    // Whichever platform the test runs as.
    process.env.EXPO_PUBLIC_PLAY_STORE_URL = PLAY;
    process.env.EXPO_PUBLIC_APP_STORE_URL = PLAY;
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(
      <LanguageProvider initial="en">
        <UpdateRequiredScreen />
      </LanguageProvider>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open the store' }));
    expect(open).toHaveBeenCalledWith(PLAY);
  });

  it('says to ask the admin when the build names no store page', async () => {
    await render(
      <LanguageProvider initial="en">
        <UpdateRequiredScreen />
      </LanguageProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Open the store' })).toBeNull();
    expect(
      screen.getByText('Ask your admin how to get the new version of the app.'),
    ).toBeOnTheScreen();
  });

  it('takes each platform’s own store page', () => {
    process.env.EXPO_PUBLIC_APP_STORE_URL = 'https://apps.apple.com/app/id1';
    expect(storeUrl('ios')).toBe('https://apps.apple.com/app/id1');
    expect(storeUrl('android')).toBeUndefined();
    expect(storeUrl('web')).toBeUndefined();
  });
});
