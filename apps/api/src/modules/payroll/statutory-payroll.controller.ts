import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import {
  PayAdjustmentBody,
  PayRunApproveBody,
  PayRunBody,
  PayRunParams,
  PayRunResult,
  PayrollUserParams as UserParams,
  SalaryStructureBody,
  SalaryStructureResult,
  StatutoryPayslip,
  StatutoryPayslipParams,
  StatutoryProfileBody,
  StatutoryProfileResult,
} from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { type Access, CurrentAccess, InModule, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { StatutoryPayrollService } from './statutory-payroll.service';

/**
 * Statutory payroll (M14, BR-56 to BR-58, decision D128): salary structures, statutory profiles,
 * the month's pay run and its payslips, behind the `statutory_payroll` module.
 */
@Controller('v1')
export class StatutoryPayrollController {
  constructor(
    private readonly database: Database,
    private readonly payroll: StatutoryPayrollService,
  ) {}

  @Get('salary-structures/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "A person's salary structure, each change with the month it applies from",
    params: UserParams,
    response: SalaryStructureResult,
  })
  @Requires('salary.manage')
  structures(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { userId } = UserParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.structures(tx, access, userId),
    );
  }

  @Put('salary-structures/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "Set a person's salary structure from a month; months already paid keep theirs",
    params: UserParams,
    body: SalaryStructureBody,
    response: SalaryStructureResult,
  })
  @Requires('salary.manage')
  setStructure(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { userId } = UserParams.parse(params);
    const input = SalaryStructureBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.setStructure(tx, access, userId, input),
    );
  }

  @Get('statutory-profiles/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "A person's work state, PF and ESI details for payslips",
    params: UserParams,
    response: StatutoryProfileResult,
  })
  @Requires('salary.manage')
  profile(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { userId } = UserParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.profile(tx, access, userId),
    );
  }

  @Put('statutory-profiles/:userId')
  @Contract({
    tag: 'Payroll',
    summary: "Set a person's work state, PF and ESI details",
    params: UserParams,
    body: StatutoryProfileBody,
    response: StatutoryProfileResult,
  })
  @Requires('salary.manage')
  setProfile(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { userId } = UserParams.parse(params);
    const input = StatutoryProfileBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.setProfile(tx, access, userId, input),
    );
  }

  @Post('pay-runs')
  @Contract({
    tag: 'Payroll',
    summary:
      "Start a month's pay run as a draft, worked out now; an existing run is answered as it is",
    body: PayRunBody,
    response: PayRunResult,
    idempotencyKey: true,
  })
  @Requires('payroll.run')
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = PayRunBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/pay-runs', by: access.userId, input },
        async () => ({ status: 201, body: await this.payroll.createRun(tx, access, input.period) }),
      ),
    );
    void reply.status(result.status);
    return result.body;
  }

  @Get('pay-runs/:period')
  @Contract({
    tag: 'Payroll',
    summary: "A month's pay run and each person's totals",
    params: PayRunParams,
    response: PayRunResult,
  })
  @Requires('payroll.run')
  run(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { period } = PayRunParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.payroll.run(tx, access, period));
  }

  @Post('pay-runs/:period/recompute')
  @HttpCode(200)
  @Contract({
    tag: 'Payroll',
    summary: 'Work a draft pay run out again from today’s structures, days and adjustments',
    params: PayRunParams,
    response: PayRunResult,
  })
  @Requires('payroll.run')
  recompute(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { period } = PayRunParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.recompute(tx, access, period),
    );
  }

  @Post('pay-runs/:period/approve')
  @HttpCode(200)
  @Contract({
    tag: 'Payroll',
    summary: 'Approve a draft pay run at the version you saw, freezing its payslips',
    params: PayRunParams,
    body: PayRunApproveBody,
    response: PayRunResult,
  })
  @Requires('payroll.run')
  approve(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { period } = PayRunParams.parse(params);
    const { version } = PayRunApproveBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.approve(tx, access, period, version),
    );
  }

  @Post('pay-adjustments')
  @HttpCode(204)
  @Contract({
    tag: 'Payroll',
    summary: 'Add an earning or deduction to a person’s month, with your own ID',
    body: PayAdjustmentBody,
  })
  @Requires('payroll.run')
  async adjust(@CurrentAccess() access: Access, @Body() body: unknown): Promise<void> {
    const input = PayAdjustmentBody.parse(body);
    await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `pay_adjustment:${input.id}`,
        { route: 'POST /v1/pay-adjustments', by: access.userId, input },
        async () => {
          await this.payroll.addAdjustment(tx, access, input);
          return { status: 204, body: null };
        },
      ),
    );
  }

  @Get('statutory-payslips/:userId/:period')
  @Contract({
    tag: 'Payroll',
    summary:
      "A person's statutory payslip for a month: their own once approved, or anyone's for payroll",
    params: StatutoryPayslipParams,
    response: StatutoryPayslip,
  })
  @RequiresAny('payroll.run', 'payslip.view')
  // `payslip.view` is the estimate's too, so the module closes the route on its own (D128).
  @InModule('statutory_payroll')
  payslip(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { userId, period } = StatutoryPayslipParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.payroll.payslip(tx, access, userId, period),
    );
  }
}
