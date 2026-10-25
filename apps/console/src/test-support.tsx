import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { ApiError } from '@thelamp/api-client';
import type { StaffResult } from '@thelamp/shared';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { ConsoleClient } from './client';
import { ConsoleProvider } from './context';
import { LanguageProvider } from './i18n';
import { createConsoleRouter } from './router';

export const ADMIN: StaffResult = {
  id: '01a10000-0000-7000-8000-0000000000a1',
  email: 'meera@vendor.example',
  name: 'Meera Iyer',
  role: 'platform_admin',
  status: 'active',
  permissions: [
    'platform.tenant.manage',
    'platform.plan.manage',
    'platform.support.request',
    'platform.support.approve_emergency',
    'platform.flags.manage',
    'platform.billing.manage',
    'platform.staff.manage',
  ],
  lastSignInAt: '2026-10-24T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
};

export const TENANT = {
  id: '01a10000-0000-7000-8000-0000000000b1',
  slug: 'sunrise-agro',
  name: 'Sunrise Agro',
  status: 'trial' as const,
  cell: { name: 'local', region: 'ap-south-1', kind: 'shared' as const },
  template: { key: 'agri', version: 4 },
  plan: null,
  trialEndsAt: '2026-11-23T10:00:00.000Z',
  demo: false,
  activeUsers: 12,
  createdAt: '2026-10-24T10:00:00.000Z',
};

export const PLAN = {
  id: '01a10000-0000-7000-8000-0000000000c1',
  key: 'growth',
  name: { en: 'Growth', hi: 'ग्रोथ' },
  priceMonth: '499.00',
  priceYear: '4990.00',
  modules: ['core' as const, 'leave_attendance' as const, 'orders' as const],
  limits: { users: 25, storageGb: 50 },
  addons: [{ key: 'sms_pack', name: { en: 'SMS pack', hi: 'SMS पैक' }, price: '250.00' }],
  active: true,
  tenants: 3,
  createdAt: '2026-10-20T10:00:00.000Z',
};

/** A tenant without a plan: every module open, nothing capped. */
export const OPEN = {
  plan: null,
  extraModules: [],
  modules: ['core', 'leave_attendance', 'orders', 'account_finance', 'expenses'],
  limits: { users: null, storageGb: null },
  ownLimits: {},
};

/** An unpaid monthly invoice for Sunrise Agro, within Maharashtra (decision D90). */
export const INVOICE = {
  id: '01a10000-0000-7000-8000-0000000000e1',
  number: 'TL/26-27/00042',
  tenant: { id: TENANT.id, name: TENANT.name, slug: TENANT.slug },
  kind: 'monthly' as const,
  period: { from: '2026-10-01', to: '2026-10-31' },
  issuedOn: '2026-11-04',
  dueOn: '2099-11-19',
  seller: {
    legalName: 'Example Field Software Private Limited',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Unit 4, Example Business Park, Pune 411045',
    stateCode: '27',
    stateName: 'Maharashtra',
    email: 'billing@vendor.example',
    sac: '998314',
  },
  buyer: {
    legalName: 'Sunrise Agro Private Limited',
    gstin: null,
    address: 'Plot 9, MIDC, Nashik 422010',
    stateCode: '27',
    stateName: 'Maharashtra',
  },
  lines: [
    {
      description: 'Seats on the Growth plan, October 2026 (per seat per month, prorated by day)',
      quantity: '11.4839',
      rate: '499.00',
      amount: '5730.47',
    },
  ],
  subtotal: '5730.47',
  gstRate: '18',
  cgst: '515.74',
  sgst: '515.74',
  igst: '0.00',
  total: '6761.95',
  paid: '0.00',
  status: 'issued' as const,
  example: false,
  payments: [] as {
    id: string;
    amount: string;
    method: 'bank_transfer' | 'mandate' | 'cheque' | 'upi' | 'other';
    reference: string | null;
    receivedOn: string;
    recordedAt: string;
  }[],
};

/** A tenant with no billing details, subscription or invoices (decision D90). */
export const NO_BILLING = { account: null, subscription: null, outstanding: '0.00', dunning: null };

/**
 * The tenant page's billing and support reads, answered as for a tenant with no billing yet and
 * no support access.
 */
export function billingAnswer(path: string): unknown {
  if (path.endsWith('/billing')) return NO_BILLING;
  if (path.startsWith('/platform/v1/invoices?')) return { items: [], nextCursor: null };
  if (path.startsWith('/platform/v1/support-grants')) return { items: [] };
  return undefined;
}

type Handler = (method: string, path: string, body: unknown) => unknown;

/** A console client that answers from `handler` and never touches a network. */
export function fakeClient(staff: StaffResult | null, handler: Handler = () => ({})) {
  let current = staff;
  const client = {
    get staff() {
      return current;
    },
    restore: vi.fn(async () => current),
    signIn: vi.fn(async () => {
      current = ADMIN;
      return ADMIN;
    }),
    signOut: vi.fn(async () => {
      current = null;
    }),
    setUp: vi.fn(async () => ({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' })),
    confirm: vi.fn(async () => ({ ...ADMIN, status: 'active' as const })),
    file: vi.fn<(path: string) => Promise<Blob>>(
      async () => new Blob(['%PDF-1.3'], { type: 'application/pdf' }),
    ),
    request: vi.fn(async (method: string, path: string, _schema: unknown, body?: unknown) => {
      const answer = handler(method, path, body);
      if (answer instanceof ApiError) throw answer;
      return answer;
    }),
  };
  return client;
}

export function renderConsole(path: string, client: ReturnType<typeof fakeClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const context = { client: client as unknown as ConsoleClient, queryClient };
  const router = createConsoleRouter(context, createMemoryHistory({ initialEntries: [path] }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider initial="en">
        <ConsoleProvider value={context}>
          <RouterProvider router={router} />
        </ConsoleProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}
