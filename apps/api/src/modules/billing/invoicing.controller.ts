import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  BillingAccountBody,
  BillingSettingsBody,
  BillingSettingsResult,
  CancelSubscriptionBody,
  InvoiceIdParams,
  InvoiceListQuery,
  InvoiceListResult,
  InvoiceResult,
  MandateResult,
  RecordPaymentBody,
  SubscriptionBody,
  TenantBillingResult,
  TenantIdParams,
} from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { BillingSettings } from './billing-settings.service';
import { invoicePdf } from './invoice-pdf';
import { InvoicesService } from './invoices.service';
import { TenantBillingService } from './tenant-billing.service';

/**
 * Subscriptions, invoices and payments in the platform console (module M23, decision D90). Any
 * staff member reads them; changing them needs `platform.billing.manage`.
 */
@Controller('platform/v1')
export class InvoicingController {
  constructor(
    private readonly settings: BillingSettings,
    private readonly billing: TenantBillingService,
    private readonly invoices: InvoicesService,
  ) {}

  @ForStaff()
  @Get('billing/settings')
  @Contract({
    tag: 'Platform console',
    summary: 'The seller’s details and the dunning periods',
    response: BillingSettingsResult,
  })
  readSettings() {
    return this.settings.result();
  }

  @ForStaff('platform.billing.manage')
  @Put('billing/settings')
  @Contract({
    tag: 'Platform console',
    summary: 'Set the seller’s details and the dunning periods',
    body: BillingSettingsBody,
    response: BillingSettingsResult,
  })
  updateSettings(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.settings.update(staff, BillingSettingsBody.parse(body));
  }

  @ForStaff()
  @Get('tenants/:id/billing')
  @Contract({
    tag: 'Platform console',
    summary: 'A tenant’s billing details, subscription and what it owes',
    params: TenantIdParams,
    response: TenantBillingResult,
  })
  overview(@Param() params: unknown) {
    return this.billing.overview(TenantIdParams.parse(params).id);
  }

  @ForStaff('platform.billing.manage')
  @Put('tenants/:id/billing-account')
  @Contract({
    tag: 'Platform console',
    summary: 'Set the tenant’s details as the buyer on its invoices',
    params: TenantIdParams,
    body: BillingAccountBody,
    response: TenantBillingResult,
  })
  setAccount(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    return this.billing.setAccount(
      staff,
      TenantIdParams.parse(params).id,
      BillingAccountBody.parse(body),
    );
  }

  @ForStaff('platform.billing.manage')
  @Put('tenants/:id/subscription')
  @Contract({
    tag: 'Platform console',
    summary: 'Start a subscription, or move a monthly one to another plan',
    params: TenantIdParams,
    body: SubscriptionBody,
    response: TenantBillingResult,
  })
  subscribe(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    return this.billing.subscribe(
      staff,
      TenantIdParams.parse(params).id,
      SubscriptionBody.parse(body),
    );
  }

  @ForStaff('platform.billing.manage')
  @Post('tenants/:id/subscription/cancel')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'End a subscription: monthly today, annual at its term’s end',
    params: TenantIdParams,
    body: CancelSubscriptionBody,
    response: TenantBillingResult,
  })
  cancel(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    return this.billing.cancel(
      staff,
      TenantIdParams.parse(params).id,
      CancelSubscriptionBody.parse(body).reason,
    );
  }

  @ForStaff('platform.billing.manage')
  @Post('tenants/:id/mandate')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Set up automatic payment for a tenant',
    params: TenantIdParams,
    response: MandateResult,
  })
  authorise(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.billing.authorise(staff, TenantIdParams.parse(params).id);
  }

  @ForStaff()
  @Get('invoices')
  @Contract({
    tag: 'Platform console',
    summary: 'Invoices, newest first',
    query: InvoiceListQuery,
    response: InvoiceListResult,
  })
  list(@Query() query: unknown) {
    return this.invoices.list(InvoiceListQuery.parse(query));
  }

  @ForStaff()
  @Get('invoices/:id')
  @Contract({
    tag: 'Platform console',
    summary: 'An invoice with its payments',
    params: InvoiceIdParams,
    response: InvoiceResult,
  })
  get(@Param() params: unknown) {
    return this.invoices.get(InvoiceIdParams.parse(params).id);
  }

  @ForStaff()
  @Get('invoices/:id/pdf')
  @Contract({
    tag: 'Platform console',
    summary: 'An invoice as a PDF',
    params: InvoiceIdParams,
    file: 'application/pdf',
  })
  async pdf(@Param() params: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const row = await this.invoices.row(InvoiceIdParams.parse(params).id);
    const file = await invoicePdf(row);
    void reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="invoice-${row.number.replaceAll('/', '-')}.pdf"`,
      )
      .header('cache-control', 'private, no-store');
    return file;
  }

  @ForStaff('platform.billing.manage')
  @Post('invoices/:id/payments')
  @HttpCode(201)
  @Contract({
    tag: 'Platform console',
    summary: 'Record a payment received outside the gateway',
    params: InvoiceIdParams,
    body: RecordPaymentBody,
    response: InvoiceResult,
  })
  recordPayment(
    @CurrentStaff() staff: StaffAccess,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    return this.invoices.recordPayment(
      staff,
      InvoiceIdParams.parse(params).id,
      RecordPaymentBody.parse(body),
    );
  }
}
