import {
  clearReferenceData,
  migrate,
  Outbox,
  type OutboxItem,
  type SqlDatabase,
  SyncRunner,
  type SyncStatus,
} from '@kshetra/api-client/sync';
import { SYNC_ENTITIES } from '@kshetra/shared';
import * as Network from 'expo-network';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { useApp } from './app-state';
import { sendHeartbeat } from './heartbeat';
import { openLocalDatabase } from './local-db';
import { SENDERS } from './outbox-kinds';

/** While the app is open, it syncs this often (spec 11.3)... */
const SYNC_EVERY_MS = 60_000;
/** ...and reports its health this often (spec 12.1). */
const HEARTBEAT_EVERY_MS = 15 * 60_000;

interface Sync {
  db: SqlDatabase;
  outbox: Outbox;
  runner: SyncRunner;
}

/** The sync once the phone's database is open; null if it could not be opened. */
const SyncContext = createContext<Sync | null>(null);

/**
 * The phone's database, outbox and sync runner (spec 11.3). Once someone is signed in it syncs
 * at once, when the app comes back to the foreground, when the network returns and every minute
 * while open, and sends a heartbeat at start and every 15 minutes. Signing out clears the
 * reference data and keeps the outbox for the same person's next sign-in.
 */
export function SyncProvider({
  children,
  openDatabase = openLocalDatabase,
}: {
  children: ReactNode;
  /** For tests: a database that lives in memory. */
  openDatabase?: () => Promise<SqlDatabase>;
}) {
  const { client, session } = useApp();
  const [sync, setSync] = useState<Sync | null | 'opening'>('opening');

  useEffect(() => {
    let live = true;
    let made: Sync | undefined;
    void (async () => {
      const db = await openDatabase();
      await migrate(db);
      const outbox = new Outbox(db, SENDERS);
      const runner = new SyncRunner({
        db,
        client,
        outbox,
        entities: SYNC_ENTITIES,
        owner: () => client.owner,
      });
      await runner.refresh();
      made = { db, outbox, runner };
      if (live) setSync(made);
    })().catch(() => {
      // Without its database the phone still works online; it just keeps nothing offline.
      if (live) setSync(null);
    });
    return () => {
      live = false;
      made?.runner.stop();
    };
  }, [client, openDatabase]);

  const ready = sync === 'opening' ? null : sync;
  // The owner, not the session, so a token refresh doesn't restart everything.
  const owner = session ? client.owner : null;
  const lastOwner = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!owner) {
      if (lastOwner.current) {
        void clearReferenceData(ready.db).then(() => ready.runner.refresh());
      }
      lastOwner.current = null;
      return;
    }
    lastOwner.current = owner;
    const run = () => void ready.runner.sync();
    const beat = () => void sendHeartbeat(client, ready.runner).catch(() => undefined);
    let timers: ReturnType<typeof setInterval>[] = [];
    const start = () => {
      timers = [setInterval(run, SYNC_EVERY_MS), setInterval(beat, HEARTBEAT_EVERY_MS)];
    };
    const stop = () => timers.forEach(clearInterval);

    void ready.runner.sync().then(beat);
    start();
    const foreground = AppState.addEventListener('change', (state) => {
      stop();
      if (state === 'active') {
        run();
        start();
      }
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) run();
    });
    return () => {
      stop();
      foreground.remove();
      network.remove();
      ready.runner.stop();
    };
  }, [ready, owner, client]);

  if (sync === 'opening') return null;
  return <SyncContext.Provider value={ready}>{children}</SyncContext.Provider>;
}

export function useSync(): Sync | null {
  return useContext(SyncContext);
}

const NO_SUBSCRIPTION = () => () => undefined;

/** The runner's status, for the banner and the queue; null without a database. */
export function useSyncStatus(): SyncStatus | null {
  const sync = useSync();
  return useSyncExternalStore(
    sync ? (listener) => sync.runner.subscribe(listener) : NO_SUBSCRIPTION,
    () => sync?.runner.status ?? null,
  );
}

/** Everything the signed-in person has waiting, oldest first, kept current. */
export function useOutboxItems(): OutboxItem[] {
  const sync = useSync();
  const status = useSyncStatus();
  const { client } = useApp();
  const [found, setFound] = useState<{ owner: string; items: OutboxItem[] }>();
  useEffect(() => {
    const owner = client.owner;
    if (!sync || !owner) return;
    let live = true;
    void sync.outbox.items(owner).then((items) => {
      if (live) setFound({ owner, items });
    });
    return () => {
      live = false;
    };
  }, [sync, status, client]);
  // Someone else's items never show, even for the moment before the next read.
  return found && found.owner === client.owner ? found.items : [];
}
