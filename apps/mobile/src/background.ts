import { migrate, Outbox, Tracking } from '@thelamp/api-client/sync';
import { type MobileClient, mobileClient } from './client';
import { openLocalDatabase } from './local-db';
import { registerTrackingTask } from './tracking';

/**
 * Work the operating system wakes the app for without its screens (spec 12.1): the shift's
 * location task. It is defined when the bundle loads, before any screen, as the task manager
 * requires, with a connection and a client of its own.
 */
let opened: ReturnType<typeof open> | undefined;
async function open() {
  const db = await openLocalDatabase();
  await migrate(db);
  // Only to see which punch-ins are still waiting; the task sends nothing through it.
  return { db, outbox: new Outbox(db, {}), tracking: new Tracking(db) };
}

let client: MobileClient | undefined;

registerTrackingTask({
  open: () => (opened ??= open()),
  async client() {
    client ??= mobileClient({ onSignedOut: () => undefined, onUpgradeRequired: () => undefined });
    try {
      return (await client.restore()) ? client : null;
    } catch {
      // Offline: the points wait for the next upload.
      return null;
    }
  },
});
