import { Module } from '@nestjs/common';
import type { Config } from '../../config';
import { CONFIG } from '../../platform/tokens';
import { DirectoryModule } from '../directory/directory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingCycle } from './billing-cycle';
import { BillingNotices } from './billing-notices';
import { BillingSettings } from './billing-settings.service';
import { DunningService } from './dunning.service';
import { EntitlementsService } from './entitlements.service';
import { ExamplePlans } from './example-plans';
import { PaymentGateway, paymentGateway } from './gateway';
import { InvoicesService } from './invoices.service';
import { InvoicingController } from './invoicing.controller';
import { PlansService } from './plans.service';
import { PortalBillingController } from './portal-billing.controller';
import { TenantBillingService } from './tenant-billing.service';
import { UsageService } from './usage.service';

/**
 * Billing in the directory plane (spec 9.6, modules M22 and M23, decisions D89 and D90): plans,
 * each tenant's entitlements, metered usage, subscriptions, the vendor's GST invoices, payments
 * and dunning. Cells reach it through the `Entitlements` and `UsageRecorder` seams, and it reaches
 * them through `SeatCounts` and `TenantContacts`.
 */
@Module({
  imports: [DirectoryModule, NotificationsModule],
  controllers: [BillingController, InvoicingController, PortalBillingController],
  providers: [
    PlansService,
    EntitlementsService,
    UsageService,
    ExamplePlans,
    BillingSettings,
    BillingNotices,
    DunningService,
    InvoicesService,
    TenantBillingService,
    BillingCycle,
    { provide: PaymentGateway, inject: [CONFIG], useFactory: (c: Config) => paymentGateway(c) },
  ],
  exports: [
    EntitlementsService,
    UsageService,
    ExamplePlans,
    BillingSettings,
    TenantBillingService,
    InvoicesService,
    BillingCycle,
    PaymentGateway,
  ],
})
export class BillingModule {}
