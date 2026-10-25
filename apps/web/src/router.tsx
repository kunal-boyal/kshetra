import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { WebClient } from './client';
import { EditAccountPage, NewAccountPage } from './accounts/account-form-page';
import { AccountPage } from './accounts/account-page';
import { AccountsPage } from './accounts/accounts-page';
import { ApprovalsPage, approvalsSearch } from './approvals/approvals-page';
import { PlanPage } from './planning/plan-page';
import { ReviewPage } from './review/review-page';
import { DensityPage } from './maps/density-page';
import { LiveMapPage } from './maps/live-map-page';
import { ReplayPage } from './maps/replay-page';
import { NotificationsPage } from './notifications/notifications-page';
import { LeaderboardPage } from './performance/leaderboard-page';
import { PersonPerformancePage } from './performance/person-page';
import { TeamPerformancePage } from './performance/team-page';
import { TargetsPage } from './targets/targets-page';
import { CataloguePage } from './catalogue/catalogue-page';
import { ItemEditorPage } from './catalogue/item-editor-page';
import { OrderDeskPage } from './orders/order-desk-page';
import { OrderPage } from './orders/order-page';
import { OrdersPage } from './orders/orders-page';
import { PriceListPage } from './catalogue/price-list-page';
import { PriceListsPage } from './catalogue/price-lists-page';
import { EditFormPage, NewFormPage } from './forms/form-builder-page';
import { FormsPage } from './forms/forms-page';
import { ImportPage } from './imports/import-page';
import { ImportsPage } from './imports/imports-page';
import { AppShell } from './layout/app-shell';
import { HomePage } from './pages/home';
import { SignInPage } from './pages/sign-in';
import { OrgChartPage } from './people/org-chart-page';
import { PeoplePage } from './people/people-page';
import { EditPersonPage, NewPersonPage } from './people/person-form-page';
import { PersonPage } from './people/person-page';
import { TransferPage } from './people/transfer-page';
import { CalendarsPage } from './settings/calendars-page';
import { ExpensePoliciesPage } from './settings/expense-policies-page';
import { ExpensesPage } from './expenses/expenses-page';
import { LeaveTypesPage } from './settings/leave-types-page';
import { ConfigurationPage } from './settings/configuration-page';
import { DesignationsPage } from './settings/designations-page';
import { LevelsPage } from './settings/levels-page';
import { MetricEditorPage } from './settings/metric-editor-page';
import { MetricsPage } from './settings/metrics-page';
import { BillingPage } from './settings/billing-page';
import { SsoPage } from './settings/sso-page';
import { ModulesPage } from './settings/modules-page';
import { OrganisationPage } from './settings/organisation-page';
import { ReportsPage } from './reports/reports-page';
import { ApprovalChainsPage } from './settings/approvals-page';
import { RolesPage } from './settings/roles-page';
import { RulesPage } from './settings/rules-page';
import { SettingsLayout } from './settings/settings-layout';
import { TerminologyPage } from './settings/terminology-page';
import { TypeEditorPage } from './settings/type-editor-page';
import { TypesPage } from './settings/types-page';
import { UserFieldsPage } from './settings/user-fields-page';
import { TerritoriesPage } from './territories/territories-page';

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

const people = createRoute({ getParentRoute: () => app, path: '/people', component: PeoplePage });
const newPerson = createRoute({
  getParentRoute: () => app,
  path: '/people/new',
  component: NewPersonPage,
});
const person = createRoute({
  getParentRoute: () => app,
  path: '/people/$userId',
  component: function PersonRoute() {
    const { userId } = person.useParams();
    // A new key per person, so moving between people starts each page afresh.
    return <PersonPage key={userId} userId={userId} />;
  },
});
const editPerson = createRoute({
  getParentRoute: () => app,
  path: '/people/$userId/edit',
  component: function EditPersonRoute() {
    const { userId } = editPerson.useParams();
    return <EditPersonPage key={userId} userId={userId} />;
  },
});
const transfer = createRoute({
  getParentRoute: () => app,
  path: '/people/$userId/transfer',
  component: function TransferRoute() {
    const { userId } = transfer.useParams();
    return <TransferPage key={userId} userId={userId} />;
  },
});
const plan = createRoute({
  getParentRoute: () => app,
  path: '/people/$userId/plan',
  component: function PlanRoute() {
    const { userId } = plan.useParams();
    return <PlanPage key={userId} userId={userId} />;
  },
});
const orgChart = createRoute({
  getParentRoute: () => app,
  path: '/org-chart',
  component: OrgChartPage,
});
/** `?type=` picks an account type by key. */
const typeSearch = (search: Record<string, unknown>): { type?: string } =>
  typeof search.type === 'string' ? { type: search.type } : {};

const accounts = createRoute({
  getParentRoute: () => app,
  path: '/accounts',
  validateSearch: typeSearch,
  component: function AccountsRoute() {
    const { type } = accounts.useSearch();
    return <AccountsPage {...(type ? { type } : {})} />;
  },
});
const newAccount = createRoute({
  getParentRoute: () => app,
  path: '/accounts/new',
  validateSearch: typeSearch,
  component: function NewAccountRoute() {
    const { type } = newAccount.useSearch();
    return <NewAccountPage {...(type ? { type } : {})} />;
  },
});
const account = createRoute({
  getParentRoute: () => app,
  path: '/accounts/$accountId',
  component: function AccountRoute() {
    const { accountId } = account.useParams();
    return <AccountPage key={accountId} accountId={accountId} />;
  },
});
const editAccount = createRoute({
  getParentRoute: () => app,
  path: '/accounts/$accountId/edit',
  component: function EditAccountRoute() {
    const { accountId } = editAccount.useParams();
    return <EditAccountPage key={accountId} accountId={accountId} />;
  },
});
const approvals = createRoute({
  getParentRoute: () => app,
  path: '/approvals',
  validateSearch: approvalsSearch,
  component: function ApprovalsRoute() {
    const { view, type } = approvals.useSearch();
    return <ApprovalsPage {...(view ? { view } : {})} {...(type ? { type } : {})} />;
  },
});
const review = createRoute({ getParentRoute: () => app, path: '/review', component: ReviewPage });
const expensesRoute = createRoute({
  getParentRoute: () => app,
  path: '/expenses',
  component: ExpensesPage,
});
const ordersRoute = createRoute({
  getParentRoute: () => app,
  path: '/orders',
  component: OrdersPage,
});
const newOrder = createRoute({
  getParentRoute: () => app,
  path: '/orders/new',
  component: OrderDeskPage,
});
const order = createRoute({
  getParentRoute: () => app,
  path: '/orders/$orderId',
  component: function OrderRoute() {
    const { orderId } = order.useParams();
    return <OrderPage key={orderId} orderId={orderId} />;
  },
});
const targets = createRoute({
  getParentRoute: () => app,
  path: '/targets',
  component: TargetsPage,
});
const teamPerformance = createRoute({
  getParentRoute: () => app,
  path: '/performance',
  component: TeamPerformancePage,
});
const personPerformance = createRoute({
  getParentRoute: () => app,
  path: '/performance/$userId',
  component: function PersonPerformanceRoute() {
    const { userId } = personPerformance.useParams();
    return <PersonPerformancePage key={userId} userId={userId} />;
  },
});
const liveMap = createRoute({
  getParentRoute: () => app,
  path: '/live-map',
  component: LiveMapPage,
});
const reports = createRoute({
  getParentRoute: () => app,
  path: '/reports',
  component: ReportsPage,
});
const density = createRoute({
  getParentRoute: () => app,
  path: '/density',
  component: DensityPage,
});
const replay = createRoute({
  getParentRoute: () => app,
  path: '/people/$userId/replay',
  component: function ReplayRoute() {
    const { userId } = replay.useParams();
    return <ReplayPage key={userId} userId={userId} />;
  },
});
const notificationsRoute = createRoute({
  getParentRoute: () => app,
  path: '/notifications',
  component: NotificationsPage,
});
const leaderboard = createRoute({
  getParentRoute: () => app,
  path: '/leaderboard',
  component: LeaderboardPage,
});
const territories = createRoute({
  getParentRoute: () => app,
  path: '/territories',
  component: TerritoriesPage,
});
const imports = createRoute({
  getParentRoute: () => app,
  path: '/imports',
  component: ImportsPage,
});
const oneImport = createRoute({
  getParentRoute: () => app,
  path: '/imports/$importId',
  component: function ImportRoute() {
    const { importId } = oneImport.useParams();
    return <ImportPage key={importId} importId={importId} />;
  },
});

const settings = createRoute({
  getParentRoute: () => app,
  path: '/settings',
  component: SettingsLayout,
});
const settingsIndex = createRoute({
  getParentRoute: () => settings,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/organisation' });
  },
});
const organisation = createRoute({
  getParentRoute: () => settings,
  path: '/organisation',
  component: OrganisationPage,
});
const rules = createRoute({ getParentRoute: () => settings, path: '/rules', component: RulesPage });
const approvalChains = createRoute({
  getParentRoute: () => settings,
  path: '/approvals',
  component: ApprovalChainsPage,
});
const calendars = createRoute({
  getParentRoute: () => settings,
  path: '/calendars',
  component: CalendarsPage,
});
const expensePolicies = createRoute({
  getParentRoute: () => settings,
  path: '/expense-policies',
  component: ExpensePoliciesPage,
});
const leaveTypes = createRoute({
  getParentRoute: () => settings,
  path: '/leave-types',
  component: LeaveTypesPage,
});
const terminology = createRoute({
  getParentRoute: () => settings,
  path: '/terminology',
  component: TerminologyPage,
});
const modules = createRoute({
  getParentRoute: () => settings,
  path: '/modules',
  component: ModulesPage,
});
const billingSettings = createRoute({
  getParentRoute: () => settings,
  path: '/billing',
  component: BillingPage,
});
const ssoSettings = createRoute({
  getParentRoute: () => settings,
  path: '/sso',
  component: SsoPage,
});
const roles = createRoute({ getParentRoute: () => settings, path: '/roles', component: RolesPage });
const designations = createRoute({
  getParentRoute: () => settings,
  path: '/designations',
  component: DesignationsPage,
});
const userFields = createRoute({
  getParentRoute: () => settings,
  path: '/people-fields',
  component: UserFieldsPage,
});
const forms = createRoute({ getParentRoute: () => settings, path: '/forms', component: FormsPage });
const newForm = createRoute({
  getParentRoute: () => settings,
  path: '/forms/new',
  component: NewFormPage,
});
const editForm = createRoute({
  getParentRoute: () => settings,
  path: '/forms/$formId',
  component: function EditFormRoute() {
    const { formId } = editForm.useParams();
    return <EditFormPage key={formId} formId={formId} />;
  },
});
const catalogue = createRoute({
  getParentRoute: () => settings,
  path: '/catalogue',
  component: CataloguePage,
});
const newItem = createRoute({
  getParentRoute: () => settings,
  path: '/catalogue/items/new',
  component: () => <ItemEditorPage />,
});
const editItem = createRoute({
  getParentRoute: () => settings,
  path: '/catalogue/items/$itemId',
  component: function EditItemRoute() {
    const { itemId } = editItem.useParams();
    return <ItemEditorPage key={itemId} itemId={itemId} />;
  },
});
const priceLists = createRoute({
  getParentRoute: () => settings,
  path: '/price-lists',
  component: PriceListsPage,
});
const newPriceList = createRoute({
  getParentRoute: () => settings,
  path: '/price-lists/new',
  component: () => <PriceListPage />,
});
const priceList = createRoute({
  getParentRoute: () => settings,
  path: '/price-lists/$priceListId',
  component: function PriceListRoute() {
    const { priceListId } = priceList.useParams();
    return <PriceListPage key={priceListId} priceListId={priceListId} />;
  },
});
const accountTypes = createRoute({
  getParentRoute: () => settings,
  path: '/account-types',
  component: TypesPage,
});
const newAccountType = createRoute({
  getParentRoute: () => settings,
  path: '/account-types/new',
  component: () => <TypeEditorPage />,
});
const editAccountType = createRoute({
  getParentRoute: () => settings,
  path: '/account-types/$typeId',
  component: function EditTypeRoute() {
    const { typeId } = editAccountType.useParams();
    return <TypeEditorPage key={typeId} typeId={typeId} />;
  },
});
const configuration = createRoute({
  getParentRoute: () => settings,
  path: '/configuration',
  component: ConfigurationPage,
});
const territoryLevels = createRoute({
  getParentRoute: () => settings,
  path: '/territory-levels',
  component: LevelsPage,
});
const metrics = createRoute({
  getParentRoute: () => settings,
  path: '/metrics',
  component: MetricsPage,
});
const newMetric = createRoute({
  getParentRoute: () => settings,
  path: '/metrics/new',
  component: () => <MetricEditorPage />,
});
const editMetric = createRoute({
  getParentRoute: () => settings,
  path: '/metrics/$metricKey',
  component: function EditMetricRoute() {
    const { metricKey } = editMetric.useParams();
    return <MetricEditorPage key={metricKey} metricKey={metricKey} />;
  },
});

const tree = root.addChildren([
  signIn,
  app.addChildren([
    home,
    people,
    newPerson,
    person,
    editPerson,
    transfer,
    plan,
    orgChart,
    accounts,
    newAccount,
    account,
    editAccount,
    approvals,
    review,
    ordersRoute,
    expensesRoute,
    newOrder,
    order,
    targets,
    teamPerformance,
    personPerformance,
    leaderboard,
    notificationsRoute,
    liveMap,
    density,
    replay,
    reports,
    territories,
    imports,
    oneImport,
    settings.addChildren([
      organisation,
      rules,
      approvalChains,
      calendars,
      leaveTypes,
      expensePolicies,
      terminology,
      modules,
      billingSettings,
      ssoSettings,
      settingsIndex,
      roles,
      designations,
      userFields,
      forms,
      newForm,
      editForm,
      catalogue,
      newItem,
      editItem,
      priceLists,
      newPriceList,
      priceList,
      accountTypes,
      newAccountType,
      editAccountType,
      territoryLevels,
      metrics,
      newMetric,
      editMetric,
      configuration,
    ]),
  ]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({ routeTree: tree, context, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
