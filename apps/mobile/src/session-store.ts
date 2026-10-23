import type { SessionState, SessionStore } from '@thelamp/api-client';
import { storage } from './storage';

const KEY = 'session';

/** The session, refresh token included, kept in the secure store (spec 13.1). */
export const sessionStore: SessionStore = {
  async load() {
    const saved = storage.read(KEY);
    if (!saved) return null;
    try {
      const session = JSON.parse(saved) as Partial<SessionState>;
      return session.tenant && session.accessToken && session.accessTokenExpiresAt
        ? (session as SessionState)
        : null;
    } catch {
      return null;
    }
  },
  async save(session) {
    if (session) storage.write(KEY, JSON.stringify(session));
    else await storage.remove(KEY);
  },
};
