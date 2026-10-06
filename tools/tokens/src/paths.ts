import { fileURLToPath } from 'node:url';

/** The design system package this tool reads from and writes to. */
const root = new URL('../../../packages/design-tokens/', import.meta.url);

export const TOKENS_JSON = fileURLToPath(new URL('tokens.json', root));
export const TOKENS_CSS = fileURLToPath(new URL('tokens.css', root));
export const TOKENS_TS = fileURLToPath(new URL('tokens.ts', root));
