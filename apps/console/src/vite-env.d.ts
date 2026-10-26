/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where error reports go (decision D98); without it none are sent. */
  readonly VITE_SENTRY_DSN?: string;
}
