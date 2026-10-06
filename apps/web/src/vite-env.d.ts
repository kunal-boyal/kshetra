/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The directory's origin; empty when it is this page's own, as through the dev proxy. */
  readonly VITE_DIRECTORY_URL?: string;
  /** Overrides the cell URL the directory hands out; empty for this page's own origin. */
  readonly VITE_CELL_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
}
