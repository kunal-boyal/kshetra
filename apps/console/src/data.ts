import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AnnouncementBody,
  ConsoleAnnouncement,
  ConsoleAnnouncementList,
  type BillingAccountBody,
  CellHealthList,
  type BillingSettingsBody,
  BillingSettingsResult,
  CellListResult,
  ConsoleTenant,
  ConsoleTenantList,
  type CreatePlanBody,
  CreateTenantBody,
  InviteStaffResult,
  InvoiceListResult,
  InvoiceResult,
  MandateResult,
  type PlanBody,
  type RecordPaymentBody,
  type SubscriptionBody,
  TenantBillingResult,
  PlanListResult,
  PlanResult,
  StaffListResult,
  StaffResult,
  SupportEntryResult,
  SupportGrantList,
  SupportGrantResult,
  type SupportRequestBody,
  TemplateListResult,
  TenantEntitlements,
  type TenantPlanBody,
  type TenantStatusSchema,
  TenantUsageResult,
  DataExportList,
  DataExportResult,
} from '@thelamp/shared';
import type { z } from 'zod';
import { useConsole } from './context';

type TenantStatus = z.infer<typeof TenantStatusSchema>;

/** Tenants, a page at a time, as the API pages them, with a Load more for the next page. */
export function useTenants(filters: { status?: TenantStatus; q?: string }) {
  const { client } = useConsole();
  return useInfiniteQuery({
    queryKey: ['tenants', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '50' });
      if (filters.status) query.set('status', filters.status);
      if (filters.q) query.set('q', filters.q);
      if (pageParam) query.set('cursor', pageParam);
      return client.request('GET', `/platform/v1/tenants?${query}`, ConsoleTenantList);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useTenant(id: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['tenant', id],
    queryFn: () => client.request('GET', `/platform/v1/tenants/${id}`, ConsoleTenant),
  });
}

/** A tenant's data exports, read again every few seconds while one is being prepared. */
export function useTenantExports(id: string, enabled: boolean) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['tenant-exports', id],
    enabled,
    queryFn: () => client.request('GET', `/platform/v1/tenants/${id}/data-exports`, DataExportList),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'queued' || item.status === 'running')
        ? 5000
        : false,
  });
}

export function useTemplates() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => client.request('GET', '/platform/v1/templates', TemplateListResult),
    staleTime: Infinity,
  });
}

export function useCells() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['cells'],
    queryFn: () => client.request('GET', '/platform/v1/cells', CellListResult),
  });
}

/** Every plan, switched off ones included, with how many tenants are on each (M23). */
export function usePlans() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => client.request('GET', '/platform/v1/plans', PlanListResult),
  });
}

/** A tenant's plan, the modules beyond it and the limits in force (decision D89). */
export function useEntitlements(tenantId: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['entitlements', tenantId],
    queryFn: () =>
      client.request('GET', `/platform/v1/tenants/${tenantId}/entitlements`, TenantEntitlements),
  });
}

/** A tenant's metered usage for its last six months, newest first. */
export function useUsage(tenantId: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['usage', tenantId],
    queryFn: () =>
      client.request('GET', `/platform/v1/tenants/${tenantId}/usage?months=6`, TenantUsageResult),
  });
}

/** The seller's details and the dunning periods (decision D90). */
export function useBillingSettings() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['billing-settings'],
    queryFn: () => client.request('GET', '/platform/v1/billing/settings', BillingSettingsResult),
  });
}

/** A tenant's billing details, subscription and what it owes. */
export function useTenantBilling(tenantId: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['tenant-billing', tenantId],
    queryFn: () =>
      client.request('GET', `/platform/v1/tenants/${tenantId}/billing`, TenantBillingResult),
  });
}

/** Invoices newest first, a page at a time, for every tenant or one. */
export function useInvoices(filters: { tenantId?: string; status?: 'issued' | 'paid' }) {
  const { client } = useConsole();
  return useInfiniteQuery({
    queryKey: ['invoices', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '50' });
      if (filters.tenantId) query.set('tenantId', filters.tenantId);
      if (filters.status) query.set('status', filters.status);
      if (pageParam) query.set('cursor', pageParam);
      return client.request('GET', `/platform/v1/invoices?${query}`, InvoiceListResult);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useInvoice(id: string) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: () => client.request('GET', `/platform/v1/invoices/${id}`, InvoiceResult),
  });
}

export function useStaff() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['staff'],
    queryFn: () => client.request('GET', '/platform/v1/staff', StaffListResult),
  });
}

/** Each cell's health (decision D93), read again every minute while shown. */
export function useCellHealth() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['health'],
    queryFn: () => client.request('GET', '/platform/v1/health', CellHealthList),
    refetchInterval: 60_000,
  });
}

/** Announcements to tenants (decision D93), newest first. */
export function useAnnouncements() {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => client.request('GET', '/platform/v1/announcements', ConsoleAnnouncementList),
  });
}

/** Support grants (decision D93): a tenant's, or the signed-in staff member's own, or all. */
export function useSupportGrants(filters: { tenantId?: string; mine?: boolean }) {
  const { client } = useConsole();
  return useQuery({
    queryKey: ['support-grants', filters],
    queryFn: () => {
      const query = new URLSearchParams();
      if (filters.tenantId) query.set('tenantId', filters.tenantId);
      if (filters.mine) query.set('mine', 'true');
      return client.request('GET', `/platform/v1/support-grants?${query}`, SupportGrantList);
    },
  });
}

/** Changes go through here, and every list they touch reads again afterwards. */
export function useConsoleMutations() {
  const { client } = useConsole();
  const queries = useQueryClient();
  const refresh = (keys: string[]) =>
    Promise.all(keys.map((key) => queries.invalidateQueries({ queryKey: [key] })));
  return {
    createTenant: useMutation({
      mutationFn: (body: z.input<typeof CreateTenantBody>) =>
        client.request('POST', '/platform/v1/tenants', ConsoleTenant, body),
      onSuccess: () => refresh(['tenants', 'cells', 'plans']),
    }),
    suspend: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        client.request('POST', `/platform/v1/tenants/${id}/suspend`, ConsoleTenant, { reason }),
      onSuccess: () => refresh(['tenants', 'tenant']),
    }),
    reactivate: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/tenants/${id}/reactivate`, ConsoleTenant),
      onSuccess: () => refresh(['tenants', 'tenant']),
    }),
    terminate: useMutation({
      mutationFn: ({
        id,
        reason,
        confirmSlug,
      }: {
        id: string;
        reason: string;
        confirmSlug: string;
      }) =>
        client.request('POST', `/platform/v1/tenants/${id}/terminate`, ConsoleTenant, {
          reason,
          confirmSlug,
        }),
      onSuccess: () => refresh(['tenants', 'tenant', 'tenant-exports']),
    }),
    undoTermination: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/tenants/${id}/undo-termination`, ConsoleTenant),
      onSuccess: () => refresh(['tenants', 'tenant']),
    }),
    requestExport: useMutation({
      mutationFn: ({ id, exportId }: { id: string; exportId: string }) =>
        client.request('POST', `/platform/v1/tenants/${id}/data-exports`, DataExportResult, {
          id: exportId,
        }),
      onSuccess: () => refresh(['tenant-exports']),
    }),
    createPlan: useMutation({
      mutationFn: (body: z.input<typeof CreatePlanBody>) =>
        client.request('POST', '/platform/v1/plans', PlanResult, body),
      onSuccess: () => refresh(['plans']),
    }),
    updatePlan: useMutation({
      mutationFn: ({ id, body }: { id: string; body: z.input<typeof PlanBody> }) =>
        client.request('PUT', `/platform/v1/plans/${id}`, PlanResult, body),
      // A plan's tenants follow it at once.
      onSuccess: () => refresh(['plans', 'entitlements']),
    }),
    setPlan: useMutation({
      mutationFn: ({
        tenantId,
        body,
      }: {
        tenantId: string;
        body: z.input<typeof TenantPlanBody>;
      }) =>
        client.request('PUT', `/platform/v1/tenants/${tenantId}/plan`, TenantEntitlements, body),
      onSuccess: () => refresh(['entitlements', 'tenant', 'tenants', 'plans']),
    }),
    saveBillingSettings: useMutation({
      mutationFn: (body: z.input<typeof BillingSettingsBody>) =>
        client.request('PUT', '/platform/v1/billing/settings', BillingSettingsResult, body),
      onSuccess: () => refresh(['billing-settings']),
    }),
    saveBillingAccount: useMutation({
      mutationFn: ({
        tenantId,
        body,
      }: {
        tenantId: string;
        body: z.input<typeof BillingAccountBody>;
      }) =>
        client.request(
          'PUT',
          `/platform/v1/tenants/${tenantId}/billing-account`,
          TenantBillingResult,
          body,
        ),
      onSuccess: () => refresh(['tenant-billing']),
    }),
    subscribe: useMutation({
      mutationFn: ({
        tenantId,
        body,
      }: {
        tenantId: string;
        body: z.input<typeof SubscriptionBody>;
      }) =>
        client.request(
          'PUT',
          `/platform/v1/tenants/${tenantId}/subscription`,
          TenantBillingResult,
          body,
        ),
      // Subscribing moves the tenant's plan and status, and an annual one issues an invoice.
      onSuccess: () =>
        refresh(['tenant-billing', 'tenant', 'tenants', 'entitlements', 'invoices', 'plans']),
    }),
    cancelSubscription: useMutation({
      mutationFn: ({ tenantId, reason }: { tenantId: string; reason: string }) =>
        client.request(
          'POST',
          `/platform/v1/tenants/${tenantId}/subscription/cancel`,
          TenantBillingResult,
          { reason },
        ),
      onSuccess: () => refresh(['tenant-billing']),
    }),
    authorise: useMutation({
      mutationFn: (tenantId: string) =>
        client.request('POST', `/platform/v1/tenants/${tenantId}/mandate`, MandateResult),
      onSuccess: () => refresh(['tenant-billing', 'invoices', 'invoice']),
    }),
    recordPayment: useMutation({
      mutationFn: ({
        invoiceId,
        body,
      }: {
        invoiceId: string;
        body: z.input<typeof RecordPaymentBody>;
      }) =>
        client.request('POST', `/platform/v1/invoices/${invoiceId}/payments`, InvoiceResult, body),
      // Paying can move the tenant out of grace or read only.
      onSuccess: () => refresh(['invoice', 'invoices', 'tenant-billing', 'tenant', 'tenants']),
    }),
    announce: useMutation({
      mutationFn: (body: z.input<typeof AnnouncementBody>) =>
        client.request('POST', '/platform/v1/announcements', ConsoleAnnouncement, body),
      onSuccess: () => refresh(['announcements']),
    }),
    withdraw: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/announcements/${id}/withdraw`, ConsoleAnnouncement),
      onSuccess: () => refresh(['announcements']),
    }),
    askSupport: useMutation({
      mutationFn: (body: z.input<typeof SupportRequestBody>) =>
        client.request('POST', '/platform/v1/support-grants', SupportGrantResult, body),
      onSuccess: () => refresh(['support-grants']),
    }),
    approveSupport: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/support-grants/${id}/approve`, SupportGrantResult),
      onSuccess: () => refresh(['support-grants']),
    }),
    endSupport: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/support-grants/${id}/end`, SupportGrantResult),
      onSuccess: () => refresh(['support-grants']),
    }),
    /** A one-time link into the tenant's portal under an open grant. */
    supportEntry: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/support-grants/${id}/enter`, SupportEntryResult),
    }),
    invite: useMutation({
      mutationFn: (body: { id: string; email: string; name: string; role: string }) =>
        client.request('POST', '/platform/v1/staff', InviteStaffResult, body),
      onSuccess: () => refresh(['staff']),
    }),
    disable: useMutation({
      mutationFn: (id: string) =>
        client.request('POST', `/platform/v1/staff/${id}/disable`, StaffResult),
      onSuccess: () => refresh(['staff']),
    }),
  };
}
