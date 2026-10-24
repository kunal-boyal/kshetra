import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  AddReceiptsBody,
  CreateExpenseClaimBody,
  ExpenseClaimListQuery,
  ExpenseClaimListResult,
  ExpenseClaimResult,
  ExpensePoliciesBody,
  ExpensePolicyListResult,
  IdParams,
  MarkPaidBody,
} from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, InModule, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpensePoliciesService } from './expense-policies.service';

/** Expense policies and claims (M12, spec 11.2, decision D83). */
@Controller('v1')
export class ExpensesController {
  constructor(
    private readonly database: Database,
    private readonly policies: ExpensePoliciesService,
    private readonly claims: ExpenseClaimsService,
  ) {}

  @Get('expense-policies')
  @Contract({
    tag: 'Expenses',
    summary: 'The expense policies as they stand, in order',
    response: ExpensePolicyListResult,
  })
  @SignedIn()
  @InModule('expenses')
  async listPolicies(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.policies.list(tx, access.tenantId),
      ),
    };
  }

  @Put('expense-policies')
  @Contract({
    tag: 'Expenses',
    summary: 'Replace the expense policies; a changed policy gets a version from a day',
    body: ExpensePoliciesBody,
    response: ExpensePolicyListResult,
  })
  @Requires('expense_policy.manage')
  replacePolicies(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = ExpensePoliciesBody.parse(body);
    return this.database.forTenant(access.tenantId, async (tx) => {
      await this.policies.replace(tx, access.tenantId, userActor(access), input.items, input.from);
      return { items: await this.policies.list(tx, access.tenantId) };
    });
  }

  @Post('expense-claims')
  @Contract({
    tag: 'Expenses',
    summary: 'Claim an expense',
    body: CreateExpenseClaimBody,
    response: ExpenseClaimResult,
  })
  @Requires('expense.claim')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateExpenseClaimBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `expense_claim:${input.id}`,
        { route: 'POST /v1/expense-claims', by: access.userId, input },
        async () => ({ status: 201, body: await this.claims.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get('expense-claims')
  @Contract({
    tag: 'Expenses',
    summary: 'Claims of a person, or of everyone you reach, newest first',
    query: ExpenseClaimListQuery,
    response: ExpenseClaimListResult,
  })
  @SignedIn()
  @InModule('expenses')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ExpenseClaimListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.claims.list(tx, access, input));
  }

  @Post('expense-claims/:id/receipts')
  @Contract({
    tag: 'Expenses',
    summary: 'Add receipts to your claim while it waits',
    params: IdParams,
    body: AddReceiptsBody,
    response: ExpenseClaimResult,
    idempotencyKey: true,
  })
  @Requires('expense.claim')
  @HttpCode(200)
  async addReceipts(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const claimId = pathId(id);
    const input = AddReceiptsBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/expense-claims/:id/receipts', by: access.userId, claimId, input },
        async () => ({
          status: 200,
          body: await this.claims.addReceipts(tx, access, claimId, input.mediaIds),
        }),
      ),
    );
    return result.body;
  }

  @Post('expense-claims/:id/paid')
  @Contract({
    tag: 'Expenses',
    summary: 'Mark an approved claim paid',
    params: IdParams,
    body: MarkPaidBody,
    response: ExpenseClaimResult,
    idempotencyKey: true,
  })
  @Requires('expense.mark_paid')
  @HttpCode(200)
  async markPaid(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const claimId = pathId(id);
    const input = MarkPaidBody.parse(body ?? {});
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/expense-claims/:id/paid', by: access.userId, claimId, input },
        async () => ({
          status: 200,
          body: await this.claims.markPaid(tx, access, claimId, input),
        }),
      ),
    );
    return result.body;
  }
}
