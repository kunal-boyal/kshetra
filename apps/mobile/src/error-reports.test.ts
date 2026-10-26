import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/react-native';
import { startErrorReports } from './error-reports';

describe('error reports on the phone (decision D98)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    jest.mocked(Sentry.init).mockClear();
  });

  it('stay off without a DSN', () => {
    expect(startErrorReports()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('send errors only, scrubbed of numbers and tokens', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@sentry.example/1';
    expect(startErrorReports()).toBe(true);
    const options = jest.mocked(Sentry.init).mock.calls[0]![0]!;
    expect(options).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0 });
    const event = { message: 'Upload for +919876543210 failed' };
    expect(options.beforeSend!(event as never, {})).toEqual({
      message: 'Upload for [number] failed',
    });
  });
});
