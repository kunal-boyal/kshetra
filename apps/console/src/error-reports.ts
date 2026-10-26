import { scrub } from '@thelamp/shared';

/**
 * Error reports to Sentry (spec 9.3, decision D98), off until `VITE_SENTRY_DSN` is set; only
 * then is the SDK fetched. Uncaught errors go, scrubbed of numbers, addresses, codes, tokens and
 * signed URLs, with no traces, replays or personal details.
 */
export function startErrorReports(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  void import('@sentry/react')
    .then((Sentry) =>
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: (event) => scrub(event),
        beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
      }),
    )
    .catch(() => undefined);
}
