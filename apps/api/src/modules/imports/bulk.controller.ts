import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import {
  AppError,
  BulkAccountsBody,
  BulkBody,
  BulkFieldsQuery,
  BulkFieldsResult,
  BulkResult,
  type BulkTarget,
  type ImportTarget,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { ImportRefused, type ImportRow, ImportTargets } from './targets';

/** The import target each bulk route loads. */
const TARGET_OF: Record<BulkTarget, string> = {
  users: 'users',
  accounts: 'accounts',
  items: 'items',
  'ledger-entries': 'ledger_entries',
  'external-metrics': 'external_metrics',
};

/**
 * Bulk upserts for masters (spec 11.2, module M20, decision D94): the rows of a file import, as
 * JSON, for systems such as an ERP or an HR system. Each route checks every row with its target's
 * own import and writes all of them in one transaction, or none, answering `IMPORT_ERRORS` with
 * each problem at `rows.<index>.<field>`. An `Idempotency-Key` makes a resend apply once.
 */
@Controller('v1/bulk')
export class BulkController {
  constructor(
    private readonly database: Database,
    private readonly targets: ImportTargets,
  ) {}

  @Get('fields')
  @RequiresAny(
    'user.manage',
    'account.import',
    'catalogue.manage',
    'finance.manage',
    'metric.record',
  )
  @Contract({
    tag: 'Integrations',
    summary: 'The fields a bulk upsert takes, custom fields included',
    query: BulkFieldsQuery,
    response: BulkFieldsResult,
  })
  async fields(@CurrentAccess() access: Access, @Query() query: unknown) {
    const { target, accountType } = BulkFieldsQuery.parse(query);
    const name = this.targetName(target, accountType);
    const source = this.targets.get(name);
    if (!access.permissions.has(source.permission)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this.');
    }
    const fields = await this.database.forTenant(access.tenantId, (tx) =>
      this.fieldsOf(tx, access.tenantId, name),
    );
    return {
      fields: fields.map((field) => ({
        key: field.key,
        required: field.required,
        label: field.label ?? null,
      })),
    };
  }

  @Post('users')
  @HttpCode(200)
  @Requires('user.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Add or update people, as the people import does',
    body: BulkBody,
    response: BulkResult,
    idempotencyKey: true,
  })
  users(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.load(access, 'users', BulkBody.parse(body).rows, key);
  }

  @Post('accounts')
  @HttpCode(200)
  @Requires('account.import')
  @Contract({
    tag: 'Integrations',
    summary: 'Add or update accounts of one type, as the accounts import does',
    body: BulkAccountsBody,
    response: BulkResult,
    idempotencyKey: true,
  })
  accounts(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const input = BulkAccountsBody.parse(body);
    return this.load(access, this.targetName('accounts', input.accountType), input.rows, key);
  }

  @Post('items')
  @HttpCode(200)
  @Requires('catalogue.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Add or update items and their prices, as the items import does',
    body: BulkBody,
    response: BulkResult,
    idempotencyKey: true,
  })
  items(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.load(access, 'items', BulkBody.parse(body).rows, key);
  }

  @Post('ledger-entries')
  @HttpCode(200)
  @Requires('finance.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Add statement entries, keyed by their reference, as the import does',
    body: BulkBody,
    response: BulkResult,
    idempotencyKey: true,
  })
  ledger(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.load(access, 'ledger_entries', BulkBody.parse(body).rows, key);
  }

  @Post('external-metrics')
  @HttpCode(200)
  @Requires('metric.record')
  @Contract({
    tag: 'Integrations',
    summary: 'Load external metric values for people or accounts, by day or month',
    body: BulkBody,
    response: BulkResult,
    idempotencyKey: true,
  })
  external(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.load(access, 'external_metrics', BulkBody.parse(body).rows, key);
  }

  /** A target's fields; an account type that doesn't exist is the request's `accountType`. */
  private async fieldsOf(tx: TenantTx, tenantId: string, target: string) {
    try {
      return await this.targets.get(target).fields(tx, tenantId, target as ImportTarget);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'VALIDATION' &&
        target.startsWith('accounts:')
      ) {
        throw unknownType();
      }
      throw error;
    }
  }

  private targetName(target: BulkTarget, accountType: string | undefined): string {
    if (target !== 'accounts') return TARGET_OF[target];
    if (!accountType) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'accountType', issue: 'Name the type of account' },
      ]);
    }
    return `accounts:${accountType}`;
  }

  /** Checks and writes every row, or none, once for a key. */
  private async load(
    access: Access,
    target: string,
    rows: readonly Record<string, string | number | boolean | null>[],
    key: string | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(key);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        idempotencyKey,
        { route: `POST /v1/bulk ${target}`, by: access.userId, rows },
        async () => ({ status: 200, body: await this.write(tx, access, target, rows) }),
      ),
    );
    return result.body;
  }

  private async write(
    tx: TenantTx,
    access: Access,
    target: string,
    rows: readonly Record<string, string | number | boolean | null>[],
  ) {
    const source = this.targets.get(target);
    const importRows: ImportRow[] = rows.map((row, index) => ({
      row: index + 1,
      cells: Object.fromEntries(
        Object.entries(row).map(([field, value]) => [
          field,
          typeof value === 'number' ? String(value) : value,
        ]),
      ),
    }));
    const context = {
      access,
      target: target as ImportTarget,
      emptyValues: [],
      fractions: [],
    };
    if (target.startsWith('accounts:')) await this.fieldsOf(tx, access.tenantId, target);
    const problems = await source.check(tx, importRows, context);
    if (problems.length > 0) throw refused(problems);
    try {
      return await source.commit(tx, importRows, context);
    } catch (error) {
      if (error instanceof ImportRefused) throw refused(error.problems);
      throw error;
    }
  }
}

const unknownType = () =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [
    { path: 'accountType', issue: 'There is no such type of account' },
  ]);

/** The rows' problems at `rows.<index>.<field>`; nothing was written. */
function refused(problems: readonly { row: number | null; field: string | null; issue: string }[]) {
  return new AppError(
    'IMPORT_ERRORS',
    'Some rows have problems; nothing was written.',
    // A problem with no row, such as a missing column, is about the rows as a whole.
    problems.slice(0, 200).map((problem) => ({
      path:
        problem.row === null
          ? `rows${problem.field ? `.*.${problem.field}` : ''}`
          : `rows.${problem.row - 1}${problem.field ? `.${problem.field}` : ''}`,
      issue: problem.issue,
    })),
  );
}
