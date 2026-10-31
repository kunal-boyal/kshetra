import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { PayrollGrossImport } from './payroll-gross.import';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/** Payroll inputs (M14): spec 9.6 `hr`'s monthly gross and provisional pay, decision D117. */
@Module({
  imports: [IamModule, FieldModule, ImportsModule, TenantConfigModule],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollGrossImport],
  exports: [PayrollService],
})
export class PayrollModule {}
