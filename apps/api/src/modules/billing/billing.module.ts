import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { BillingController } from './billing.controller';
import { EntitlementsService } from './entitlements.service';
import { ExamplePlans } from './example-plans';
import { PlansService } from './plans.service';
import { UsageService } from './usage.service';

/**
 * Billing in the directory plane (spec 9.6, modules M22 and M23, decision D89): plans, each
 * tenant's entitlements, and metered usage. Subscriptions, invoices and payments join in step 3.
 * Cells reach it through the `Entitlements` and `UsageRecorder` seams.
 */
@Module({
  imports: [DirectoryModule],
  controllers: [BillingController],
  providers: [PlansService, EntitlementsService, UsageService, ExamplePlans],
  exports: [EntitlementsService, UsageService, ExamplePlans],
})
export class BillingModule {}
