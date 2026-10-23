import type { SessionState } from '@thelamp/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type ClientEvents, type MobileClient, mobileClient } from './client';
import { forgetTenants } from './preferences';

interface AppState {
  client: MobileClient;
  queryClient: QueryClient;
  /** Null until signed in, and again once signed out. */
  session: SessionState | null;
  /** False until the saved session has been looked for at start-up. */
  restored: boolean;
  /** Picks up the client's session after signing in or switching tenant. */
  sync: () => void;
  /** The API no longer supports this version: the app shows only its update screen. */
  upgradeRequired: boolean;
}

const AppContext = createContext<AppState | null>(null);

/**
 * The client and the session as React state. Signing in, switching and signing out change the
 * session, and the router's guards move between sign-in and the app in response.
 */
export function AppProvider({
  children,
  createClient = mobileClient,
  queryClient: givenQueryClient,
}: {
  children: ReactNode;
  /** For tests: a client that answers like the API without one. */
  createClient?: (events: ClientEvents) => MobileClient;
  /** For tests: a cache whose timers end with the test. */
  queryClient?: QueryClient;
}) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [restored, setRestored] = useState(false);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [queryClient] = useState(
    () =>
      givenQueryClient ??
      new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }),
  );
  const [client] = useState(() =>
    createClient({
      onSignedOut: () => {
        setSession(null);
        queryClient.clear();
        void forgetTenants();
      },
      onUpgradeRequired: () => setUpgradeRequired(true),
    }),
  );

  useEffect(() => {
    let live = true;
    // A refresh that can't reach the server keeps the saved session: the phone works offline,
    // and the next request refreshes. An ended session comes back as none.
    client
      .restore()
      .catch(() => client.session)
      .then((found) => {
        if (!live) return;
        setSession(found);
        setRestored(true);
      });
    return () => {
      live = false;
    };
  }, [client]);

  const sync = useCallback(() => setSession(client.session), [client]);
  const value = useMemo(
    () => ({ client, queryClient, session, restored, sync, upgradeRequired }),
    [client, queryClient, session, restored, sync, upgradeRequired],
  );
  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp needs an AppProvider.');
  return app;
}
