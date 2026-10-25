import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  AppError,
  BillingAccountBody,
  InvoiceIdParams,
  InvoiceListResult,
  InvoiceResult,
  MandateResult,
  PortalBillingResult,
  PortalInvoiceQuery,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { tenants } from '../../db/schema/directory';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, WhileReadOnly } from '../../platform/auth';
import { Database } from '../../platform/database';
import { SeatCounts } from '../../platform/planes';
import { Contract } from '../../platform/routes';
import { DirectoryDatabase } from '../directory/directory.database';
import { EntitlementsService } from './entitlements.service';
import { PaymentGateway } from './gateway';
import { invoicePdf } from './invoice-pdf';
import { InvoicesService } from './invoices.service';
import { PlansService } from './plans.service';
import { TenantBillingService } from './tenant-billing.service';
import { UsageService } from './usage.service';

const noSuchInvoice = () => new AppError('NOT_FOUND', 'There is no such invoice.');

/**
 * The tenant admin's billing in the portal (spec M23, decision D90): the organisation's plan,
 * people and usage, its billing details, automatic payment, where it stands, and its invoices.
 * Only `billing.manage` sees it, and only ever its own organisation's. Paying and keeping the
 * billing details right stay open while the organisation is read only (BR-48).
 */
@Controller('v1/billing')
export class PortalBillingController {
  constructor(
    private readonly billing: TenantBillingService,
    private readonly invoices: InvoicesService,
    private readonly entitlements: EntitlementsService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
    private readonly seats: SeatCounts,
    private readonly gateway: PaymentGateway,
    private readonly directory: DirectoryDatabase,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  @Get()
  @Requires('billing.manage')
  @Contract({
    tag: 'Billing',
    summary: 'The organisation’s plan, people, subscription, standing and usage',
    response: PortalBillingResult,
  })
  async overview(@CurrentAccess() access: Access) {
    const tenantId = access.tenantId;
    const [standing, entitled, plans, active, usage, [tenant]] = await Promise.all([
      this.billing.overview(tenantId),
      this.entitlements.detail(tenantId),
      this.plans.list(),
      this.seats.active(tenantId),
      this.usage.forTenant(tenantId, 3),
      this.directory.db
        .select({ trialEndsAt: tenants.trialEndsAt, status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, tenantId)),
    ]);
    const plan = plans.find((each) => each.id === entitled.plan?.id);
    return {
      ...standing,
      plan: plan
        ? { name: plan.name, priceMonth: plan.priceMonth, priceYear: plan.priceYear }
        : null,
      modules: entitled.modules,
      people: { active, limit: entitled.limits.users },
      trialEndsAt:
        tenant?.status === 'trial' && tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
      automaticPayment: this.gateway.enabled,
      usage: usage.items,
    };
  }

  @Get('invoices')
  @Requires('billing.manage')
  @Contract({
    tag: 'Billing',
    summary: 'The organisation’s invoices, newest first',
    query: PortalInvoiceQuery,
    response: InvoiceListResult,
  })
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    return this.invoices.list({ ...PortalInvoiceQuery.parse(query), tenantId: access.tenantId });
  }

  @Get('invoices/:id')
  @Requires('billing.manage')
  @Contract({
    tag: 'Billing',
    summary: 'One of the organisation’s invoices, with its payments',
    params: InvoiceIdParams,
    response: InvoiceResult,
  })
  async get(@CurrentAccess() access: Access, @Param() params: unknown) {
    return this.own(access, InvoiceIdParams.parse(params).id);
  }

  @Get('invoices/:id/pdf')
  @Requires('billing.manage')
  @Contract({
    tag: 'Billing',
    summary: 'One of the organisation’s invoices as a PDF',
    params: InvoiceIdParams,
    file: 'application/pdf',
  })
  async pdf(
    @CurrentAccess() access: Access,
    @Param() params: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const invoice = await this.own(access, InvoiceIdParams.parse(params).id);
    const file = await invoicePdf(await this.invoices.row(invoice.id));
    void reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="invoice-${invoice.number.replaceAll('/', '-')}.pdf"`,
      )
      .header('cache-control', 'private, no-store');
    return file;
  }

  @Put('account')
  @Requires('billing.manage')
  @WhileReadOnly()
  @Contract({
    tag: 'Billing',
    summary: 'Set the organisation’s details as the buyer on its invoices',
    body: BillingAccountBody,
    response: PortalBillingResult,
  })
  async setAccount(@CurrentAccess() access: Access, @Body() body: unknown) {
    const parsed = BillingAccountBody.parse(body);
    const before = (await this.billing.overview(access.tenantId)).account;
    await this.billing.setAccount(null, access.tenantId, parsed);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'billing.account_changed',
        target: { type: 'organisation', id: access.tenantId },
        before,
        after: parsed,
      }),
    );
    return this.overview(access);
  }

  @Post('mandate')
  @HttpCode(200)
  @Requires('billing.manage')
  @WhileReadOnly()
  @Contract({
    tag: 'Billing',
    summary: 'Set up automatic payment of invoices',
    response: MandateResult,
    idempotencyKey: true,
  })
  async authorise(@CurrentAccess() access: Access) {
    const result = await this.billing.authorise(null, access.tenantId);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'billing.mandate_started',
        target: { type: 'organisation', id: access.tenantId },
        after: { pending: Boolean(result.url) },
      }),
    );
    return result;
  }

  /** An invoice of the caller's own organisation; any other answers as if it didn't exist. */
  private async own(access: Access, invoiceId: string) {
    try {
      const invoice = await this.invoices.get(invoiceId);
      if (invoice.tenant.id === access.tenantId) return invoice;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
    throw noSuchInvoice();
  }
}
