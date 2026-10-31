import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  PayrollGrossBody,
  PayrollGrossResult,
  PayrollListResult,
  PayrollQuery,
  PayrollUserParams as UserParams,
  PayslipParams,
  PayslipResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { PayrollService } from './payroll.service';

/** Payroll inputs (M14, decisions D14 and D117): gross, the month's estimates and the payslip. */
@Controller('v1')
export class PayrollController {
  constructor(
    private readonly database: Database,
    private readonly payroll: PayrollService,
  ) {}

  @Get('payroll')
  @Contract({
    tag: 'Payroll',
    summary: 'Provisional pay for a month, for everyone the caller reaches (BR-26)',
    query: PayrollQuery,
    response: PayrollListResult,
  })
  @Requires('payroll.manage')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = PayrollQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.list(tx, access, input.period, input.cursor, input.limit),
    );
  }

  @Get('payroll-gross/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "A person's monthly gross, each change with the month it applies from",
    params: UserParams,
    response: PayrollGrossResult,
  })
  @Requires('payroll.manage')
  gross(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { userId } = UserParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.payroll.gross(tx, access, userId));
  }

  @Put('payroll-gross/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "Set a person's monthly gross from a month; earlier months keep theirs",
    params: UserParams,
    body: PayrollGrossBody,
    response: PayrollGrossResult,
  })
  @Requires('payroll.manage')
  setGross(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { userId } = UserParams.parse(params);
    const input = PayrollGrossBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.setGross(tx, access, userId, input),
    );
  }

  @Get('payslips/:userId/:period')
  @Contract({
    tag: 'Payroll',
    summary: "A person's payslip preview for a month: an attendance-based estimate",
    params: PayslipParams,
    response: PayslipResult,
  })
  @RequiresAny('payroll.manage', 'payslip.view')
  payslip(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { userId, period } = PayslipParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.payslip(tx, access, userId, period),
    );
  }
}
