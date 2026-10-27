/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The directory's origin; empty when it is this page's own, as through the dev proxy. */
  readonly VITE_DIRECTORY_URL?: string;
  /** Overrides the cell URL the directory hands out; empty for this page's own origin. */
  readonly VITE_CELL_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
  /** The web Maps key (decision D60); without it maps show a notice. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** A Maps map ID for advanced markers; Google's demo ID by default. */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
  /** The provider's privacy address, shown on the privacy notice and the deletion page (D100). */
  readonly VITE_PRIVACY_EMAIL?: string;
  /** Where error reports go (decision D98); without it none are sent. */
  readonly VITE_SENTRY_DSN?: string;
}
