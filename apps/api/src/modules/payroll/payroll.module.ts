import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { PayrollGrossImport } from './payroll-gross.import';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryStructuresImport } from './salary-structures.import';
import { StatutoryPayrollController } from './statutory-payroll.controller';
import { StatutoryPayrollService } from './statutory-payroll.service';

/** Payroll inputs (M14): spec 9.6 `hr`'s monthly gross and provisional pay, decision D117. */
@Module({
  imports: [IamModule, FieldModule, ImportsModule, TenantConfigModule],
  controllers: [PayrollController, StatutoryPayrollController],
  providers: [PayrollService, PayrollGrossImport, StatutoryPayrollService, SalaryStructuresImport],
  exports: [PayrollService, StatutoryPayrollService],
})
export class PayrollModule {}
