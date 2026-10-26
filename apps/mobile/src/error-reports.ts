import * as Sentry from '@sentry/react-native';
import { scrub } from '@thelamp/shared';

/**
 * Error reports to Sentry (spec 9.3, decision D98), off until `EXPO_PUBLIC_SENTRY_DSN` is set in
 * the build. Uncaught errors and native crashes go, scrubbed of numbers, addresses, codes, tokens
 * and signed URLs, with no traces, replays or personal details. Native crash reports and source
 * maps need a development build made after the Sentry account exists.
 */
export function startErrorReports(): boolean {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
  });
  return true;
}
