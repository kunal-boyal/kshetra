import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { reportError, sentryOptions, startErrorReports } from './error-reports';

describe('error reports (decision D98)', () => {
  it('stay off without a DSN', () => {
    expect(startErrorReports({ SENTRY_DSN: undefined, CELL_ID: 'local' } as never, 'api')).toBe(
      false,
    );
    expect(() => reportError(new Error('nothing listens'), { queue: 'imports' })).not.toThrow();
  });

  it('send errors only, scrubbed of numbers, codes and tokens', () => {
    const options = sentryOptions(
      { SENTRY_DSN: 'https://key@sentry.example/1', CELL_ID: 'cell1' } as never,
      'worker',
    );
    expect(options).toMatchObject({
      sendDefaultPii: false,
      tracesSampleRate: 0,
      initialScope: { tags: { cell: 'cell1', process: 'worker' } },
    });
    const event = {
      message: 'OTP 482913 for +919876543210 failed',
      request: { headers: { authorization: 'Bearer abc.def' }, url: '/v1/x?token=abc' },
    } as unknown as ErrorEvent;
    expect(options.beforeSend!(event, {})).toEqual({
      message: 'OTP [code] for [number] failed',
      request: { headers: { authorization: '[removed]' }, url: '/v1/x?token=[removed]' },
    });
  });
});
