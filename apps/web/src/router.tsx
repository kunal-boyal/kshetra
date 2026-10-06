import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { WebClient } from './client';
import { AppShell } from './layout/app-shell';
import { HomePage } from './pages/home';
import { SignInPage } from './pages/sign-in';

export interface RouterContext {
  client: WebClient;
  queryClient: QueryClient;
}

const root = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signIn = createRoute({
  getParentRoute: () => root,
  path: '/sign-in',
  component: SignInPage,
  beforeLoad: ({ context }) => {
    if (context.client.session) throw redirect({ to: '/' });
  },
});

/** Everything behind sign-in. */
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  component: AppShell,
  beforeLoad: ({ context }) => {
    if (!context.client.session) throw redirect({ to: '/sign-in' });
  },
});

const home = createRoute({ getParentRoute: () => app, path: '/', component: HomePage });

const tree = root.addChildren([signIn, app.addChildren([home])]);

export function createAppRouter(context: RouterContext) {
  return createRouter({ routeTree: tree, context, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
