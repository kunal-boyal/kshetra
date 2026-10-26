import * as Sentry from '@sentry/node';
import { scrub } from '@thelamp/shared';
import type { Config } from '../config';

let started = false;

/**
 * Error reports to Sentry (spec 9.3, decision D98), off until `SENTRY_DSN` is set. Only errors
 * go, no traces or request bodies, and every event and breadcrumb is scrubbed of phone numbers,
 * addresses, codes, tokens and signed URLs first. Each process starts it once, naming itself.
 */
type ReportsConfig = Pick<
  Config,
  'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_RELEASE' | 'CELL_ID'
>;

/** What the SDK starts with; apart for tests. */
export function sentryOptions(
  config: ReportsConfig & { SENTRY_DSN: string },
  process: 'api' | 'worker' | 'scheduler',
): Sentry.NodeOptions {
  return {
    dsn: config.SENTRY_DSN,
    ...(config.SENTRY_ENVIRONMENT ? { environment: config.SENTRY_ENVIRONMENT } : {}),
    ...(config.SENTRY_RELEASE ? { release: config.SENTRY_RELEASE } : {}),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Errors only: Sentry's tracing would need its own start-up hooks, and spec 9.3 gives traces
    // to OpenTelemetry.
    skipOpenTelemetrySetup: true,
    initialScope: { tags: { cell: config.CELL_ID, process } },
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
  };
}

export function startErrorReports(
  config: ReportsConfig,
  process: 'api' | 'worker' | 'scheduler',
): boolean {
  if (started || !config.SENTRY_DSN) return started;
  Sentry.init(sentryOptions({ ...config, SENTRY_DSN: config.SENTRY_DSN }, process));
  started = true;
  return started;
}

/** Reports an error with what it happened in, such as the request or the job; nothing when off. */
export function reportError(
  error: unknown,
  context: Record<string, string | number | undefined>,
): void {
  if (!started) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}
