import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  AccountFinanceResult,
  FinanceSnapshot,
  FinanceSnapshotBody,
  IdParams,
  LedgerEntriesBody,
  LedgerEntriesResult,
  StatementQuery,
  StatementResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { FinanceService } from './finance.service';

/** Account finance (M11, spec 11.2, decision D79). */
@Controller('v1')
export class FinanceController {
  constructor(
    private readonly database: Database,
    private readonly finance: FinanceService,
  ) {}

  @Post('finance-snapshots')
  @Contract({
    tag: 'Finance',
    summary: "An account's balance on a day, with its ageing, under its own ID",
    body: FinanceSnapshotBody,
    response: FinanceSnapshot,
  })
  @Requires('finance.manage')
  @HttpCode(201)
  addSnapshot(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = FinanceSnapshotBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.finance.addSnapshot(tx, access, input),
    );
  }

  @Post('ledger-entries')
  @Contract({
    tag: 'Finance',
    summary: 'Add statement entries; one sent again unchanged changes nothing',
    body: LedgerEntriesBody,
    response: LedgerEntriesResult,
    idempotencyKey: true,
  })
  @Requires('finance.manage')
  @HttpCode(200)
  async addEntries(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = LedgerEntriesBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/ledger-entries', by: access.userId, input },
        async () => ({ status: 200, body: await this.finance.addEntries(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get('accounts/:id/finance')
  @Contract({
    tag: 'Finance',
    summary: "An account's latest balance and the ones before it",
    params: IdParams,
    response: AccountFinanceResult,
  })
  @Requires('finance.view')
  forAccount(@CurrentAccess() access: Access, @Param('id') id: string) {
    const accountId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.finance.forAccount(tx, access, accountId),
    );
  }

  @Get('accounts/:id/statement')
  @Contract({
    tag: 'Finance',
    summary: "An account's statement for a financial year, with running balances",
    params: IdParams,
    query: StatementQuery,
    response: StatementResult,
  })
  @Requires('finance.view')
  statement(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = StatementQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.finance.statement(tx, access, accountId, input.year),
    );
  }
}
