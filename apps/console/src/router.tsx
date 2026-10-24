import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ConsoleContext } from './context';
import { NewTenantPage } from './pages/new-tenant';
import { SetupPage } from './pages/setup';
import { SignInPage } from './pages/sign-in';
import { StaffPage } from './pages/staff';
import { TenantPage } from './pages/tenant';
import { TenantsPage } from './pages/tenants';
import { Shell } from './shell';

const root = createRootRouteWithContext<ConsoleContext>()({ component: Outlet });

const signIn = createRoute({
  getParentRoute: () => root,
  path: '/sign-in',
  component: SignInPage,
  beforeLoad: ({ context }) => {
    if (context.client.staff) throw redirect({ to: '/' });
  },
});

/** Setting up from an invitation; the link's secret travels in the fragment, never to a server log. */
const setup = createRoute({ getParentRoute: () => root, path: '/setup', component: SetupPage });

/** Everything behind sign-in. */
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  component: Shell,
  beforeLoad: ({ context }) => {
    if (!context.client.staff) throw redirect({ to: '/sign-in' });
  },
});

const tenants = createRoute({ getParentRoute: () => app, path: '/', component: TenantsPage });
const newTenant = createRoute({
  getParentRoute: () => app,
  path: '/tenants/new',
  component: NewTenantPage,
});
const tenant = createRoute({
  getParentRoute: () => app,
  path: '/tenants/$tenantId',
  component: function TenantRoute() {
    const { tenantId } = tenant.useParams();
    return <TenantPage key={tenantId} tenantId={tenantId} />;
  },
});
const staff = createRoute({ getParentRoute: () => app, path: '/staff', component: StaffPage });

const routeTree = root.addChildren([
  signIn,
  setup,
  app.addChildren([tenants, newTenant, tenant, staff]),
]);

export function createConsoleRouter(context: ConsoleContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: false,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createConsoleRouter>;
  }
}
