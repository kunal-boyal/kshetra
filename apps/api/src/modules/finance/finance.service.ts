import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type AccountFinanceResult,
  ageingIssue,
  AppError,
  entryIssue,
  type ErrorDetail,
  type FinanceSnapshot,
  type FinanceSnapshotBody,
  financialYear,
  financialYearOf,
  issueAt,
  type LedgerEntriesBody,
  type LedgerEntriesResult,
  openingBalance,
  runningBalances,
  scaled,
  STATEMENT_LIMIT,
  type StatementResult,
  todayIn,
} from '@thelamp/shared';
import { and, asc, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { financeSnapshots, ledgerEntries } from '../../db/schema/finance';
import { type AuditActor, AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { AccountBalances } from '../accounts/account-balances';
import { OrderCredit } from '../orders/order-credit';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

type SnapshotRow = typeof financeSnapshots.$inferSelect;
type EntryInput = LedgerEntriesBody['entries'][number];

/** Amounts as stored compare by value: `100` and `100.00` are the same entry. */
const sameAmount = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && scaled(a, 2) === scaled(b, 2));

/**
 * Account finance (M11, decision D79): balance snapshots with their ageing (BR-20), every one
 * kept and the latest shown with its date, and statement entries, only ever added, with opening,
 * running and closing balances (BR-21). They come from the customer's accounts software through
 * imports or the API, or from back office. The latest snapshot's credit limit decides whether an
 * order goes over it, for the order chain (D73).
 */
@Injectable()
export class FinanceService implements OnModuleInit {
  constructor(
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
    private readonly credit: OrderCredit,
    private readonly audit: AuditLog,
    private readonly balances: AccountBalances,
  ) {}

  onModuleInit(): void {
    this.balances.provide({
      latest: async (tx, tenantId, accountIds) => {
        if (accountIds.length === 0) return new Map();
        // Each account's newest snapshot, as `latest()` picks it for one.
        const rows = await tx
          .selectDistinctOn([financeSnapshots.accountId], {
            accountId: financeSnapshots.accountId,
            outstanding: financeSnapshots.outstanding,
          })
          .from(financeSnapshots)
          .where(
            and(
              eq(financeSnapshots.tenantId, tenantId),
              inArray(financeSnapshots.accountId, [...new Set(accountIds)]),
            ),
          )
          .orderBy(
            financeSnapshots.accountId,
            desc(financeSnapshots.asOf),
            desc(financeSnapshots.createdAt),
          );
        return new Map(rows.map((row) => [row.accountId, row.outstanding]));
      },
    });
    this.credit.provide({
      over: async (tx, tenantId, accountId, total) => {
        const latest = await this.latest(tx, tenantId, accountId);
        if (!latest || latest.creditLimit === null) return false;
        return scaled(latest.outstanding, 2) + scaled(total, 2) > scaled(latest.creditLimit, 2);
      },
    });
  }

  /**
   * A snapshot's problems, by field: its account, a day not in the future, and ageing by the
   * tenant's buckets that adds up to no more than outstanding (BR-20).
   */
  async snapshotIssues(
    tx: TenantTx,
    tenantId: string,
    input: Omit<FinanceSnapshotBody, 'id' | 'accountId'>,
    path: (field: string) => (string | number)[] = (field) => [field],
  ): Promise<ErrorDetail[]> {
    const settings = await this.config.settings(tx, tenantId);
    const issues: ErrorDetail[] = [];
    if (input.asOf > todayIn(settings.timezone)) {
      issues.push(issueAt(path('asOf'), 'A balance can’t be from a day still to come'));
    }
    const buckets = new Set(settings.ageingBuckets.map((bucket) => bucket.key));
    for (const key of Object.keys(input.ageing)) {
      if (!buckets.has(key))
        issues.push(issueAt(path(`ageing.${key}`), 'There is no such ageing bucket'));
    }
    const ageing = ageingIssue(input.outstanding, input.ageing);
    if (ageing) issues.push(issueAt(path('ageing'), ageing));
    return issues;
  }

  /** `POST /v1/finance-snapshots`: one account's balance on a day (M11). */
  async addSnapshot(
    tx: TenantTx,
    access: Access,
    body: FinanceSnapshotBody,
  ): Promise<FinanceSnapshot> {
    await this.accounts.find(tx, access, body.accountId);
    const issues = await this.snapshotIssues(tx, access.tenantId, body);
    if (issues.length > 0) throw invalid(issues);
    const [existing] = await tx
      .select()
      .from(financeSnapshots)
      .where(and(eq(financeSnapshots.tenantId, access.tenantId), eq(financeSnapshots.id, body.id)));
    if (existing) return snapshotResult(existing);
    await this.insertSnapshots(tx, access.tenantId, userActor(access), [body], null);
    return this.snapshot(tx, access.tenantId, body.id);
  }

  async insertSnapshots(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    snapshots: readonly FinanceSnapshotBody[],
    importId: string | null,
  ): Promise<void> {
    if (snapshots.length === 0) return;
    const by = actor.kind === 'user' ? actor.id : null;
    await tx.insert(financeSnapshots).values(
      snapshots.map((snapshot) => ({
        ...snapshot,
        tenantId,
        importId,
        createdBy: by,
      })),
    );
    await this.audit.record(tx, tenantId, actor, {
      action: 'finance.snapshots_added',
      target: { type: 'account', id: snapshots.length === 1 ? snapshots[0]!.accountId : null },
      after: { count: snapshots.length, importId },
    });
  }

  private async snapshot(tx: TenantTx, tenantId: string, id: string): Promise<FinanceSnapshot> {
    const [row] = await tx
      .select()
      .from(financeSnapshots)
      .where(and(eq(financeSnapshots.tenantId, tenantId), eq(financeSnapshots.id, id)));
    return snapshotResult(row!);
  }

  /** The latest snapshot: the latest day, and of one day the one added last. */
  async latest(tx: TenantTx, tenantId: string, accountId: string): Promise<FinanceSnapshot | null> {
    const [row] = await tx
      .select()
      .from(financeSnapshots)
      .where(
        and(eq(financeSnapshots.tenantId, tenantId), eq(financeSnapshots.accountId, accountId)),
      )
      .orderBy(desc(financeSnapshots.asOf), desc(financeSnapshots.createdAt))
      .limit(1);
    return row ? snapshotResult(row) : null;
  }

  /** `GET /v1/accounts/{id}/finance`: the latest snapshot and the twelve before it. */
  async forAccount(tx: TenantTx, access: Access, accountId: string): Promise<AccountFinanceResult> {
    await this.accounts.find(tx, access, accountId);
    const rows = await tx
      .select()
      .from(financeSnapshots)
      .where(
        and(
          eq(financeSnapshots.tenantId, access.tenantId),
          eq(financeSnapshots.accountId, accountId),
        ),
      )
      .orderBy(desc(financeSnapshots.asOf), desc(financeSnapshots.createdAt))
      .limit(13);
    const [latest, ...history] = rows.map(snapshotResult);
    return { latest: latest ?? null, history };
  }

  /**
   * Statement entries' problems, and what is new: an entry's reference is its key, so one sent
   * again unchanged is left as it is and one changed is refused, as entries are only added (BR-21).
   */
  async planEntries(
    tx: TenantTx,
    tenantId: string,
    entries: readonly EntryInput[],
    path: (index: number, field: string) => (string | number)[] = (index, field) => [
      'entries',
      index,
      field,
    ],
  ): Promise<{ issues: ErrorDetail[]; fresh: EntryInput[]; unchanged: number }> {
    const issues: ErrorDetail[] = [];
    const known = await this.accounts.existing(
      tx,
      tenantId,
      entries.map((entry) => entry.accountId),
    );
    const references = entries.map((entry) => entry.reference);
    const stored = new Map(
      (references.length === 0
        ? []
        : await tx
            .select()
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenantId, tenantId),
                inArray(ledgerEntries.reference, references),
              ),
            )
      ).map((row) => [row.reference, row]),
    );
    const seen = new Set<string>();
    const fresh: EntryInput[] = [];
    let unchanged = 0;
    entries.forEach((entry, index) => {
      if (!known.has(entry.accountId)) {
        issues.push(issueAt(path(index, 'accountId'), 'There is no account with this ID'));
        return;
      }
      const side = entryIssue(entry);
      if (side) issues.push(issueAt(path(index, 'debit'), side));
      if (seen.has(entry.reference)) {
        issues.push(issueAt(path(index, 'reference'), 'This reference appears twice'));
        return;
      }
      seen.add(entry.reference);
      const before = stored.get(entry.reference);
      if (!before) {
        if (!side) fresh.push(entry);
        return;
      }
      const same =
        before.accountId === entry.accountId &&
        before.date === entry.date &&
        (before.description ?? null) === (entry.description ?? null) &&
        sameAmount(before.debit, entry.debit) &&
        sameAmount(before.credit, entry.credit);
      if (same) unchanged += 1;
      else {
        issues.push(
          issueAt(
            path(index, 'reference'),
            'An entry with this reference differs; entries are never changed, so post a reversing entry',
          ),
        );
      }
    });
    return { issues, fresh, unchanged };
  }

  async insertEntries(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    entries: readonly EntryInput[],
    source: string,
    importId: string | null,
  ): Promise<void> {
    if (entries.length === 0) return;
    const by = actor.kind === 'user' ? actor.id : null;
    await tx
      .insert(ledgerEntries)
      .values(entries.map((entry) => ({ ...entry, tenantId, source, importId, createdBy: by })));
    await this.audit.record(tx, tenantId, actor, {
      action: 'finance.entries_added',
      target: { type: 'account', id: null },
      after: {
        count: entries.length,
        references: entries.map((entry) => entry.reference),
        importId,
      },
    });
  }

  /** `POST /v1/ledger-entries` (M11). */
  async addEntries(
    tx: TenantTx,
    access: Access,
    body: LedgerEntriesBody,
  ): Promise<LedgerEntriesResult> {
    const { issues, fresh, unchanged } = await this.planEntries(tx, access.tenantId, body.entries);
    if (issues.length > 0) throw invalid(issues);
    await this.insertEntries(tx, access.tenantId, userActor(access), fresh, 'api', null);
    return { created: fresh.length, unchanged };
  }

  /**
   * `GET /v1/accounts/{id}/statement` (BR-21): one financial year, opening with every entry
   * before it, each entry with its running balance, at most 1,000 listed, and the closing
   * balance counting every entry of the year.
   */
  /**
   * The account statement report (M18): the entries of the accounts `accountIds` selects dated
   * from `from` to `to`, by account and date, each with its account's running balance over
   * every entry before it (BR-21), so a page later in the month still starts from the right one.
   */
  async statementRows(
    tx: TenantTx,
    tenantId: string,
    accountIds: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ) {
    const result = await tx.execute<{
      id: string;
      account_id: string;
      date: string;
      reference: string;
      description: string | null;
      debit: string;
      credit: string;
      balance: string;
    }>(sql`
      select id, account_id, date::text, reference, description, debit::text, credit::text,
             balance::text
        from (
          select e.*, sum(e.debit - e.credit) over (
                   partition by e.account_id order by e.date, e.created_at, e.id) as balance
            from ${ledgerEntries} e
           where e.tenant_id = ${tenantId}
             and e.account_id::text in ${accountIds}
             and e.date <= ${to}
        ) statement
       where date >= ${from}
       order by account_id, date, created_at, id
       offset ${offset} limit ${limit + 1}`);
    return result.rows;
  }

  async statement(
    tx: TenantTx,
    access: Access,
    accountId: string,
    year?: number,
  ): Promise<StatementResult> {
    await this.accounts.find(tx, access, accountId);
    const settings = await this.config.settings(tx, access.tenantId);
    const period =
      year === undefined
        ? financialYear(todayIn(settings.timezone), settings.financialYearStartMonth)
        : financialYearOf(year, settings.financialYearStartMonth);
    const where = and(
      eq(ledgerEntries.tenantId, access.tenantId),
      eq(ledgerEntries.accountId, accountId),
    );
    const [before] = await tx
      .select({
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)::numeric(18,2)::text`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)::numeric(18,2)::text`,
      })
      .from(ledgerEntries)
      .where(and(where, lt(ledgerEntries.date, period.from)));
    const opening = openingBalance(
      [{ date: '', debit: before!.debit, credit: before!.credit }],
      period.from,
    );
    const inYear = and(where, sql`${ledgerEntries.date} between ${period.from} and ${period.to}`);
    const [totals] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)::numeric(18,2)::text`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)::numeric(18,2)::text`,
      })
      .from(ledgerEntries)
      .where(inYear);
    const rows = await tx
      .select()
      .from(ledgerEntries)
      .where(inYear)
      .orderBy(asc(ledgerEntries.date), asc(ledgerEntries.createdAt), asc(ledgerEntries.reference))
      .limit(STATEMENT_LIMIT);
    const balances = runningBalances(opening, rows);
    const [closing] = runningBalances(opening, [
      { date: period.to, debit: totals!.debit, credit: totals!.credit },
    ]);
    return {
      from: period.from,
      to: period.to,
      opening,
      closing: closing!,
      entries: rows.map((row, index) => ({
        id: row.id,
        date: row.date,
        reference: row.reference,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        balance: balances[index]!,
      })),
      truncated: totals!.count > STATEMENT_LIMIT,
      count: totals!.count,
    };
  }
}

function snapshotResult(row: SnapshotRow): FinanceSnapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    asOf: row.asOf,
    outstanding: row.outstanding,
    creditLimit: row.creditLimit,
    inventoryValue: row.inventoryValue,
    ageing: row.ageing,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}
