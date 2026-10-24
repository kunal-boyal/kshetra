import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpensePoliciesService } from './expense-policies.service';
import { ExpensesController } from './expenses.controller';

/** Expense policies and claims (M12): spec 9.6 `expenses`, decision D82. */
@Module({
  imports: [IamModule, FieldModule, PhotosModule, TenantConfigModule, WorkflowModule],
  controllers: [ExpensesController],
  providers: [ExpensePoliciesService, ExpenseClaimsService],
  exports: [ExpensePoliciesService, ExpenseClaimsService],
})
export class ExpensesModule {}
