/**
 * Which prototype artboard each built portal page answers to, and the phase U stage that redoes it
 * (docs/superpowers/plans/2026-10-27-ui-revamp.md). The field app's pairs joined with stage M2.
 */
export interface Pair {
  key: string;
  title: string;
  /** The artboard in `prototype/`. */
  prototype: string;
  /**
   * The portal page: a path, or a list whose nth row link is followed (and given a suffix), for
   * pages that need an ID. Null where the portal has no such page yet.
   */
  portal: string | { list: string; nth?: number; suffix?: string } | null;
  stage: string;
  /** Screenshot the portal signed out. */
  signedOut?: boolean;
  /**
   * The platform console's page, signed in as vendor staff, or the field app's screen, run in a
   * browser at 390 px and signed in as a fresh test person (stage M2).
   */
  app?: 'console' | 'phone';
}

export const PAIRS: readonly Pair[] = [
  {
    key: 'sign-in',
    title: 'Sign in',
    prototype: 'WebSignIn.dc.html',
    portal: '/sign-in',
    stage: 'U2',
    signedOut: true,
  },
  { key: 'home', title: 'Home dashboard', prototype: 'WebHome.dc.html', portal: '/', stage: 'U3' },
  {
    key: 'performance',
    title: 'Performance',
    prototype: 'WebPerformance.dc.html',
    portal: '/performance',
    stage: 'U3',
  },
  {
    key: 'leaderboard',
    title: 'Leaderboard',
    prototype: 'WebPerformance.dc.html',
    portal: '/leaderboard',
    stage: 'U3',
  },
  {
    key: 'review',
    title: 'Review queue',
    prototype: 'WebReview.dc.html',
    portal: '/review',
    stage: 'U4',
  },
  {
    key: 'live',
    title: 'Live map',
    prototype: 'WebLive.dc.html',
    portal: '/live-map',
    stage: 'U5',
  },
  {
    key: 'orders',
    title: 'Orders',
    prototype: 'WebOrders.dc.html',
    portal: '/orders',
    stage: 'U6',
  },
  {
    key: 'people',
    title: 'People',
    prototype: 'WebPeople.dc.html',
    portal: '/people',
    stage: 'U7',
  },
  {
    key: 'accounts',
    title: 'Accounts',
    prototype: 'WebAccounts.dc.html',
    portal: '/accounts',
    stage: 'U7',
  },
  {
    key: 'plans',
    title: 'Beat plans and targets',
    prototype: 'WebPlans.dc.html',
    portal: { list: '/people', nth: 3, suffix: '/plan' },
    stage: 'U8',
  },
  {
    key: 'attendance',
    title: 'Attendance register and leave',
    prototype: 'WebAttendance.dc.html',
    portal: '/attendance',
    stage: 'U8',
  },
  {
    key: 'expenses',
    title: 'Expenses',
    prototype: 'WebExpenses.dc.html',
    portal: '/expenses',
    stage: 'U9',
  },
  {
    key: 'finance',
    title: 'Account finance',
    prototype: 'WebFinance.dc.html',
    portal: { list: '/accounts' },
    stage: 'U9',
  },
  {
    key: 'settings',
    title: 'Organisation settings',
    prototype: 'WebSettings.dc.html',
    portal: '/settings/organisation',
    stage: 'U10',
  },
  {
    key: 'workflows',
    title: 'Approval chains and channels',
    prototype: 'WebWorkflows.dc.html',
    portal: '/settings/approvals',
    stage: 'U10',
  },
  {
    key: 'billing',
    title: 'Subscription and billing',
    prototype: 'WebBilling.dc.html',
    portal: '/settings/billing',
    stage: 'U10',
  },
  {
    key: 'security',
    title: 'Security, audit and data',
    prototype: 'WebSecurity.dc.html',
    portal: '/settings/security',
    stage: 'U10',
  },
  {
    key: 'developers',
    title: 'API and webhooks',
    prototype: 'WebDevelopers.dc.html',
    portal: '/settings/developers',
    stage: 'U10',
  },
  {
    key: 'forms',
    title: 'Form builder',
    prototype: 'WebForms.dc.html',
    portal: { list: '/settings/forms' },
    stage: 'U11',
  },
  {
    key: 'imports',
    title: 'Imports',
    prototype: 'WebImports.dc.html',
    // The latest import, as it stands after its check.
    portal: { list: '/imports' },
    stage: 'U11',
  },
  {
    key: 'reports',
    title: 'Reports and exports',
    prototype: 'WebReports.dc.html',
    portal: '/reports',
    stage: 'U11',
  },
  {
    key: 'catalogue',
    title: 'Catalogue and price lists',
    prototype: 'WebCatalogue.dc.html',
    portal: '/settings/catalogue',
    stage: 'U11',
  },
  {
    key: 'console-tenants',
    title: 'Console: tenants',
    prototype: 'ConsoleTenants.dc.html',
    portal: '/',
    stage: 'U12',
    app: 'console',
  },
  {
    key: 'console-tenant',
    title: 'Console: a tenant',
    prototype: 'ConsoleTenant.dc.html',
    // The second tenant by slug: locally, the demo tenant, which has a month of activity.
    portal: { list: '/', nth: 1 },
    stage: 'U12',
    app: 'console',
  },
  {
    key: 'console-onboard',
    title: 'Console: a new tenant',
    prototype: 'ConsoleOnboard.dc.html',
    portal: '/tenants/new',
    stage: 'U12',
    app: 'console',
  },
  {
    key: 'console-billing',
    title: 'Console: plans and invoices',
    prototype: 'ConsoleBilling.dc.html',
    portal: '/billing',
    stage: 'U12',
    app: 'console',
  },
  {
    key: 'console-cells',
    title: 'Console: cells and health',
    prototype: 'ConsoleCells.dc.html',
    portal: '/health',
    stage: 'U12',
    app: 'console',
  },
  {
    key: 'app-sign-in',
    title: 'Field app: sign in',
    prototype: 'AppSignIn.dc.html',
    portal: '/',
    stage: 'M2',
    signedOut: true,
    app: 'phone',
  },
  {
    key: 'app-home',
    title: 'Field app: Home',
    prototype: 'AppHome.dc.html',
    portal: '/',
    stage: 'M2',
    app: 'phone',
  },
];
