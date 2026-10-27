/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where error reports go (decision D98); without it none are sent. */
  readonly VITE_SENTRY_DSN?: string;
  /** `production` or `staging`, shown as a badge in the bar (decision D104); local builds leave it out. */
  readonly VITE_ENVIRONMENT?: string;
}
