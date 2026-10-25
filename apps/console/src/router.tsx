import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ConsoleContext } from './context';
import { BillingPage } from './pages/billing';
import { BillingSettingsPage } from './pages/billing-settings';
import { InvoicePage } from './pages/invoice';
import { NewTenantPage } from './pages/new-tenant';
import { NewPlanPage, PlanPage } from './pages/plan';
import { PlansPage } from './pages/plans';
import { SetupPage } from './pages/setup';
import { SignInPage } from './pages/sign-in';
import { StaffPage } from './pages/staff';
import { SupportPage } from './pages/support';
import { AnnouncementsPage } from './pages/announcements';
import { HealthPage } from './pages/health';
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
const plans = createRoute({ getParentRoute: () => app, path: '/plans', component: PlansPage });
const newPlan = createRoute({
  getParentRoute: () => app,
  path: '/plans/new',
  component: NewPlanPage,
});
const plan = createRoute({
  getParentRoute: () => app,
  path: '/plans/$planId',
  component: function PlanRoute() {
    const { planId } = plan.useParams();
    return <PlanPage key={planId} planId={planId} />;
  },
});
const billing = createRoute({
  getParentRoute: () => app,
  path: '/billing',
  component: BillingPage,
});
const billingSettings = createRoute({
  getParentRoute: () => app,
  path: '/billing/settings',
  component: BillingSettingsPage,
});
const invoice = createRoute({
  getParentRoute: () => app,
  path: '/invoices/$invoiceId',
  component: function InvoiceRoute() {
    const { invoiceId } = invoice.useParams();
    return <InvoicePage key={invoiceId} invoiceId={invoiceId} />;
  },
});
const staff = createRoute({ getParentRoute: () => app, path: '/staff', component: StaffPage });
const health = createRoute({ getParentRoute: () => app, path: '/health', component: HealthPage });
const announcements = createRoute({
  getParentRoute: () => app,
  path: '/announcements',
  component: AnnouncementsPage,
});
const support = createRoute({
  getParentRoute: () => app,
  path: '/support',
  component: SupportPage,
});

const routeTree = root.addChildren([
  signIn,
  setup,
  app.addChildren([
    tenants,
    newTenant,
    tenant,
    plans,
    newPlan,
    plan,
    billing,
    billingSettings,
    invoice,
    staff,
    support,
    announcements,
    health,
  ]),
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
