import type { SessionState, SessionStore } from './client';

/**
 * A session kept only in memory, as the web keeps it: a reload starts empty and restores the
 * session from the refresh cookie.
 */
export function memoryStore(): SessionStore {
  let kept: SessionState | null = null;
  return {
    async load() {
      return kept;
    },
    async save(session) {
      kept = session;
    },
  };
}
