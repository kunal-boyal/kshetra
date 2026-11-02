import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  customerRow,
  type ErpEntity,
  type ErpIssue,
  type ErpMapped,
  type ErpMapping,
  type ErpProblem,
  type ErpRow,
  type ErpRunResult,
  ErpSettings,
  type ImportTarget,
  invoiceRow,
  itemRow,
  newId,
  paymentRow,
  perItemSalesBook,
  type ZohoContact,
  type ZohoInvoice,
  type ZohoItem,
  type ZohoPayment,
  type ZohoPriceBook,
} from '@thelamp/shared';

import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Config } from '../../config';
import { erpConnections, erpLinks, erpRuns } from '../../db/schema/erp';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, AccessResolver } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { Database, type TenantTx } from '../../platform/database';
import { reportError } from '../../platform/error-reports';
import { CONFIG } from '../../platform/tokens';
import { AccountsService } from '../accounts/accounts.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { ImportRefused, type ImportRow, ImportTargets } from '../imports/targets';
import { type ConnectionRow, ErpConnectionsService, sealedAt } from './erp-connections.service';
import {
  CallMeter,
  ZohoBooks,
  ZohoDailyLimit,
  ZohoFailed,
  type ZohoLink,
  ZohoRateLimited,
  ZohoReconnect,
} from './zoho-books';

/** Rows committed in one transaction. */
const BATCH = 500;
/** Problems kept a run, so a run over a broken mapping stays readable. */
const PROBLEMS_KEPT = 200;
const DAY_MS = 86_400_000;

type Counts = NonNullable<ErpRunResult['counts'][ErpEntity]>;

/** A record read from the books, mapped to a row of an import target, or why it isn't. */
interface Candidate {
  externalId: string;
  /** Its number, code or name in the books, to find it there. */
  label: string;
  /** When the books last changed it, where they say. */
  modified: string | null;
  mapped: ErpMapped;
  /** What the row is known by here: an account's code, an item's SKU, an invoice's number. */
  localKey: (row: ErpRow) => string;
}

interface Link {
  localKey: string | null;
  fingerprint: string | null;
  externalModified: string | null;
}

/** Everything a run carries from step to step. */
interface Run {
  id: string;
  tenantId: string;
  connection: ConnectionRow;
  access: Access;
  link: ZohoLink;
  meter: CallMeter;
  settings: ErpSettings;
  mapping: ErpMapping;
  /** A run asked for by Sync now reads every customer's own page again. */
  full: boolean;
  counts: Partial<Record<ErpEntity, Counts>>;
  problems: ErpProblem[];
  /** Items read this run by Zoho's ID, which price books refer to. */
  items: Map<string, ZohoItem>;
}

/** A row as an import's cells: empty values left out, so they change nothing already there. */
function compact(row: ErpRow): ErpRow {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== ''));
}

/** A stable digest of a row, which tells whether the books changed what it writes. */
export function fingerprint(row: ErpRow): string {
  const sorted = Object.keys(row)
    .sort()
    .map((key) => [key, row[key]]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/**
 * Reads a connection's books into the tenant's records (module M20, BR-59, decision D129):
 * customers, items, price books, invoices and payments, in that order so references resolve. Every
 * row passes its import target's own check and commit as the connection; rows refused are listed
 * and the rest written. A record whose row is unchanged costs no write, and a customer the books
 * haven't changed costs no read of its own page.
 */
@Injectable()
export class ErpPull {
  private readonly logger = new Logger(ErpPull.name);

  constructor(
    private readonly database: Database,
    private readonly connections: ErpConnectionsService,
    private readonly zoho: ZohoBooks,
    private readonly resolver: AccessResolver,
    private readonly targets: ImportTargets,
    private readonly accounts: AccountsService,
    private readonly priceLists: PriceListsService,
    private readonly cipher: ColumnCipher,
    private readonly audit: AuditLog,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** The hourly run, or Sync now's (`runId`); a tenant without a working connection is skipped. */
  async run(tenantId: string, connectionId: string | null, runId: string | null): Promise<void> {
    const connection = await this.database.forTenant(tenantId, (tx) =>
      connectionId
        ? this.connections.byId(tx, tenantId, connectionId).catch(() => undefined)
        : this.connections.row(tx, tenantId),
    );
    if (!connection) return;
    const ready =
      connection.status === 'connected' &&
      connection.refreshTokenSealed &&
      connection.organizationId &&
      connection.accountsServer &&
      connection.apiDomain;
    let access: Access | null = null;
    if (ready) {
      access = await this.resolver
        .forConnector(
          tenantId,
          { connectionId: connection.id, provider: connection.provider },
          this.config.CELL_ID,
        )
        .catch((error: unknown) => {
          if (error instanceof AppError) return null;
          throw error;
        });
    }
    // A closed module, a read-only or moving tenant, or no working connection: nothing to read.
    if (!ready || !access || access.readOnly || access.moving) {
      if (runId) await this.close(tenantId, runId, 'failed', ready ? 'error' : 'reconnect');
      return;
    }
    const id =
      runId ??
      (await this.database.forTenant(tenantId, async (tx) => {
        if (await this.connections.running(tx, tenantId, connection.id)) return null;
        const fresh = newId();
        await tx.insert(erpRuns).values({
          tenantId,
          id: fresh,
          connectionId: connection.id,
          kind: 'pull',
          status: 'running',
        });
        return fresh;
      }));
    if (!id) return;

    const settings = ErpSettings.parse(connection.settings);
    const today = new Date().toISOString().slice(0, 10);
    const run: Run = {
      id,
      tenantId,
      connection,
      access,
      link: {
        connectionId: connection.id,
        accountsServer: connection.accountsServer!,
        apiDomain: connection.apiDomain!,
        refreshToken: this.cipher.open(connection.refreshTokenSealed!, sealedAt(connection.id)),
        organizationId: connection.organizationId,
      },
      meter: new CallMeter(
        connection.callsDay === today ? connection.callsUsed : 0,
        settings.dailyCalls,
      ),
      settings,
      mapping: {
        accountType: settings.accountType,
        territoryField: settings.territoryField,
        defaultTerritory: settings.defaultTerritory,
        units: settings.units,
      },
      full: runId !== null,
      counts: {},
      problems: [],
      items: new Map(),
    };

    let stoppedBy: ErpRunResult['stoppedBy'] = null;
    try {
      if (settings.read.customers) await this.customers(run);
      if (settings.read.items) {
        await this.items(run);
        await this.priceBooks(run);
      }
      if (settings.read.invoices) await this.invoices(run);
      if (settings.read.payments) await this.payments(run);
    } catch (error) {
      if (error instanceof ZohoDailyLimit) stoppedBy = 'daily_limit';
      else if (error instanceof ZohoRateLimited) stoppedBy = 'rate_limited';
      else if (error instanceof ZohoReconnect) stoppedBy = 'reconnect';
      else {
        stoppedBy = 'error';
        if (!(error instanceof ZohoFailed)) reportError(error, { tenantId, job: 'erp.pull' });
        this.logger.warn(
          `A pull for ${tenantId} stopped: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    await this.finish(run, stoppedBy, today);
  }

  private async customers(run: Run): Promise<void> {
    const links = await this.links(run, 'account');
    const counts = this.counts(run, 'account');
    const changed: ZohoContact[] = [];
    for await (const page of this.zoho.list<ZohoContact>(
      run.link,
      run.meter,
      'contacts',
      'contacts',
      {
        contact_type: 'customer',
      },
    )) {
      for (const listed of page) {
        counts.read += 1;
        const link = links.get(listed.contact_id);
        if (
          !run.full &&
          link?.externalModified &&
          link.externalModified === (listed.last_modified_time ?? null)
        ) {
          counts.unchanged += 1;
          continue;
        }
        // Only a contact's own page has its address and custom fields.
        changed.push(
          await this.zoho.get<ZohoContact>(
            run.link,
            run.meter,
            `contacts/${listed.contact_id}`,
            'contact',
          ),
        );
      }
    }
    const present = await this.database.forTenant(run.tenantId, (tx) =>
      this.accounts.territoryCodes(
        tx,
        run.tenantId,
        changed.map((contact) => (contact.contact_number ?? '').trim()).filter(Boolean),
      ),
    );
    await this.settle(
      run,
      'account',
      `accounts:${run.settings.accountType ?? ''}`,
      links,
      changed.map((contact) => ({
        externalId: contact.contact_id,
        label: contact.contact_number || contact.contact_name,
        modified: contact.last_modified_time ?? null,
        mapped: customerRow(
          contact,
          run.mapping,
          present.get((contact.contact_number ?? '').trim()) ?? null,
        ),
        localKey: (row) => row.code!,
      })),
    );
  }

  private async items(run: Run): Promise<void> {
    const links = await this.links(run, 'item');
    const listName = await this.listName(run, run.settings.itemPriceList);
    const candidates: Candidate[] = [];
    for await (const page of this.zoho.list<ZohoItem>(run.link, run.meter, 'items', 'items')) {
      for (const item of page) {
        run.items.set(item.item_id, item);
        candidates.push({
          externalId: item.item_id,
          label: item.sku || item.name,
          modified: item.last_modified_time ?? null,
          mapped: itemRow(item, run.mapping, { rate: item.rate, list: listName }),
          localKey: (row) => row.item_code!,
        });
      }
    }
    this.counts(run, 'item').read += candidates.length;
    await this.settle(run, 'item', 'items', links, candidates);
  }

  private async priceBooks(run: Run): Promise<void> {
    if (run.settings.priceBooks.length === 0) return;
    const links = await this.links(run, 'price');
    const counts = this.counts(run, 'price');
    for (const { pricebookId, priceList } of run.settings.priceBooks) {
      const book = await this.zoho.get<ZohoPriceBook>(
        run.link,
        run.meter,
        `pricebooks/${pricebookId}`,
        'pricebook',
      );
      if (!book) continue;
      if (!perItemSalesBook(book)) {
        this.problem(run, 'price', pricebookId, book.name, 'not_per_item');
        continue;
      }
      const listName = await this.listName(run, priceList);
      const candidates: Candidate[] = (book.pricebook_items ?? []).flatMap((entry) => {
        const item = run.items.get(entry.item_id);
        if (!item) return [];
        return [
          {
            externalId: `${pricebookId}:${entry.item_id}`,
            label: `${book.name}: ${item.sku || item.name}`,
            modified: null,
            mapped: itemRow(item, run.mapping, { rate: entry.pricebook_rate, list: listName }),
            localKey: (row: ErpRow) => `${priceList}:${row.item_code}`,
          },
        ];
      });
      counts.read += candidates.length;
      await this.settle(run, 'price', 'items', links, candidates);
    }
  }

  private async invoices(run: Run): Promise<void> {
    const codes = await this.accountCodes(run);
    const links = await this.links(run, 'invoice');
    const candidates: Candidate[] = [];
    for await (const page of this.zoho.list<ZohoInvoice>(
      run.link,
      run.meter,
      'invoices',
      'invoices',
      {
        date_start: this.since(run),
      },
    )) {
      for (const invoice of page) {
        const mapped = invoiceRow(invoice, codes.get(invoice.customer_id) ?? null);
        if (!mapped) continue;
        candidates.push({
          externalId: invoice.invoice_id,
          label: invoice.invoice_number,
          modified: invoice.last_modified_time ?? null,
          mapped,
          localKey: (row) => row.number!,
        });
      }
    }
    this.counts(run, 'invoice').read += candidates.length;
    await this.settle(run, 'invoice', 'invoices', links, candidates);
  }

  private async payments(run: Run): Promise<void> {
    const codes = await this.accountCodes(run);
    const links = await this.links(run, 'receipt');
    const candidates: Candidate[] = [];
    for await (const page of this.zoho.list<ZohoPayment>(
      run.link,
      run.meter,
      'customerpayments',
      'customerpayments',
      { date_start: this.since(run) },
    )) {
      for (const payment of page) {
        candidates.push({
          externalId: payment.payment_id,
          label: payment.payment_number,
          modified: payment.last_modified_time ?? null,
          mapped: paymentRow(payment, codes.get(payment.customer_id) ?? null),
          localKey: (row) => row.number!,
        });
      }
    }
    this.counts(run, 'receipt').read += candidates.length;
    await this.settle(run, 'receipt', 'receipts', links, candidates);
  }

  /**
   * Writes what changed: records that can't be rows are listed; a row whose code another record
   * of the books already holds is listed too; an unchanged row is only marked seen; the rest go
   * through the import target, rows it refuses are listed, and the others commit with their links.
   */
  private async settle(
    run: Run,
    entity: ErpEntity,
    target: string,
    links: Map<string, Link>,
    candidates: readonly Candidate[],
  ): Promise<void> {
    const counts = this.counts(run, entity);
    const holders = new Map<string, string>();
    for (const [externalId, link] of links)
      if (link.localKey) holders.set(link.localKey, externalId);
    const seen: { externalId: string; link: Link }[] = [];
    const writes: { candidate: Candidate; row: ErpRow; key: string; print: string }[] = [];
    for (const candidate of candidates) {
      const before = links.get(candidate.externalId);
      if ('issue' in candidate.mapped) {
        counts.skipped += 1;
        this.problem(run, entity, candidate.externalId, candidate.label, candidate.mapped.issue);
        seen.push({
          externalId: candidate.externalId,
          link: {
            localKey: before?.localKey ?? null,
            fingerprint: null,
            externalModified: candidate.modified,
          },
        });
        continue;
      }
      const row = compact(candidate.mapped.row);
      const key = candidate.localKey(row);
      const holder = holders.get(key);
      if (holder && holder !== candidate.externalId) {
        counts.skipped += 1;
        this.problem(run, entity, candidate.externalId, candidate.label, 'duplicate_code');
        seen.push({
          externalId: candidate.externalId,
          link: { localKey: null, fingerprint: null, externalModified: candidate.modified },
        });
        continue;
      }
      holders.set(key, candidate.externalId);
      const print = fingerprint(row);
      if (before?.fingerprint === print && before.localKey === key) {
        counts.unchanged += 1;
        seen.push({
          externalId: candidate.externalId,
          link: { localKey: key, fingerprint: print, externalModified: candidate.modified },
        });
        continue;
      }
      writes.push({ candidate, row, key, print });
    }
    if (seen.length > 0) {
      await this.database.forTenant(run.tenantId, (tx) => this.saveLinks(tx, run, entity, seen));
    }
    for (let start = 0; start < writes.length; start += BATCH) {
      await this.commit(run, entity, target, links, writes.slice(start, start + BATCH));
    }
  }

  private async commit(
    run: Run,
    entity: ErpEntity,
    target: string,
    links: Map<string, Link>,
    batch: { candidate: Candidate; row: ErpRow; key: string; print: string }[],
  ): Promise<void> {
    const counts = this.counts(run, entity);
    const source = this.targets.get(target);
    const context = {
      access: run.access,
      target: target as ImportTarget,
      emptyValues: [],
      fractions: [],
    };
    await this.database.forTenant(run.tenantId, async (tx) => {
      if (target.startsWith('accounts:')) await source.fields(tx, run.tenantId, context.target);
      let left = batch;
      // Rows the check refuses are listed and left out; what remains is checked again, as a
      // row may have leant on one left out, until a check passes or nothing is left.
      for (let round = 0; round < 3 && left.length > 0; round += 1) {
        const rows: ImportRow[] = left.map((entry, index) => ({
          row: index + 1,
          cells: entry.row,
        }));
        const { problems } = await source.check(tx, rows, context);
        if (problems.length === 0) break;
        const refused = new Set<number>();
        for (const problem of problems) {
          const indexes = problem.row === null ? left.map((_, index) => index + 1) : [problem.row];
          for (const index of indexes) {
            if (refused.has(index)) continue;
            refused.add(index);
            const entry = left[index - 1]!;
            counts.skipped += 1;
            this.problem(
              run,
              entity,
              entry.candidate.externalId,
              entry.candidate.label,
              'refused',
              {
                field: problem.field,
                detail: problem.issue,
              },
            );
          }
        }
        left = left.filter((_, index) => !refused.has(index + 1));
      }
      if (left.length === 0) return;
      const rows: ImportRow[] = left.map((entry, index) => ({ row: index + 1, cells: entry.row }));
      try {
        const written = await source.commit(tx, rows, context);
        counts.created += written.created;
        counts.updated += written.updated;
      } catch (error) {
        if (!(error instanceof ImportRefused)) throw error;
        for (const entry of left) {
          counts.skipped += 1;
          this.problem(run, entity, entry.candidate.externalId, entry.candidate.label, 'refused', {
            field: null,
            detail: error.problems[0]?.issue ?? null,
          });
        }
        return;
      }
      await this.saveLinks(
        tx,
        run,
        entity,
        left.map((entry) => ({
          externalId: entry.candidate.externalId,
          link: {
            localKey: entry.key,
            fingerprint: entry.print,
            externalModified: entry.candidate.modified,
          },
        })),
      );
      for (const entry of left) {
        links.set(entry.candidate.externalId, {
          localKey: entry.key,
          fingerprint: entry.print,
          externalModified: entry.candidate.modified,
        });
      }
    });
  }

  private async saveLinks(
    tx: TenantTx,
    run: Run,
    entity: ErpEntity,
    entries: readonly { externalId: string; link: Link }[],
  ): Promise<void> {
    for (let start = 0; start < entries.length; start += BATCH) {
      await tx
        .insert(erpLinks)
        .values(
          entries.slice(start, start + BATCH).map(({ externalId, link }) => ({
            tenantId: run.tenantId,
            connectionId: run.connection.id,
            entity,
            externalId,
            localKey: link.localKey,
            fingerprint: link.fingerprint,
            externalModified: link.externalModified,
          })),
        )
        .onConflictDoUpdate({
          target: [erpLinks.tenantId, erpLinks.connectionId, erpLinks.entity, erpLinks.externalId],
          set: {
            localKey: sql`excluded.local_key`,
            fingerprint: sql`excluded.fingerprint`,
            externalModified: sql`excluded.external_modified`,
            updatedAt: sql`now()`,
          },
        });
    }
  }

  private async links(run: Run, entity: ErpEntity): Promise<Map<string, Link>> {
    const rows = await this.database.forTenant(run.tenantId, (tx) =>
      tx
        .select({
          externalId: erpLinks.externalId,
          localKey: erpLinks.localKey,
          fingerprint: erpLinks.fingerprint,
          externalModified: erpLinks.externalModified,
        })
        .from(erpLinks)
        .where(
          and(
            eq(erpLinks.tenantId, run.tenantId),
            eq(erpLinks.connectionId, run.connection.id),
            eq(erpLinks.entity, entity),
          ),
        ),
    );
    return new Map(rows.map(({ externalId, ...link }) => [externalId, link]));
  }

  /** Each linked customer's account code, by its ID in the books. */
  private async accountCodes(run: Run): Promise<Map<string, string>> {
    const links = await this.links(run, 'account');
    return new Map(
      [...links].flatMap(([externalId, link]) =>
        link.localKey ? [[externalId, link.localKey] as const] : [],
      ),
    );
  }

  /** A price list's name, as the items import names lists; blank is the default list. */
  private async listName(run: Run, id: string | null): Promise<string> {
    if (!id) return '';
    const lists = await this.database.forTenant(run.tenantId, (tx) =>
      this.priceLists.refs(tx, run.tenantId),
    );
    return lists.find((list) => list.id === id)?.name ?? '';
  }

  /** The first day of invoices and payments read. */
  private since(run: Run): string {
    return new Date(Date.now() - run.settings.invoiceDays * DAY_MS).toISOString().slice(0, 10);
  }

  private counts(run: Run, entity: ErpEntity): Counts {
    run.counts[entity] ??= { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 };
    return run.counts[entity]!;
  }

  private problem(
    run: Run,
    entity: ErpEntity,
    externalId: string,
    label: string,
    issue: ErpIssue,
    import_: { field: string | null; detail: string | null } = { field: null, detail: null },
  ): void {
    if (run.problems.length >= PROBLEMS_KEPT) return;
    run.problems.push({
      entity,
      externalId,
      label: label.slice(0, 120),
      issue,
      field: import_.field,
      detail: import_.detail,
    });
  }

  private async finish(run: Run, stoppedBy: ErpRunResult['stoppedBy'], today: string) {
    const wrote = Object.values(run.counts).reduce(
      (sum, counts) => sum + counts.created + counts.updated,
      0,
    );
    const status: ErpRunResult['status'] =
      stoppedBy === 'reconnect' || stoppedBy === 'error'
        ? wrote > 0
          ? 'partial'
          : 'failed'
        : stoppedBy || run.problems.length > 0
          ? 'partial'
          : 'ok';
    await this.database.forTenant(run.tenantId, async (tx) => {
      const now = new Date();
      await tx
        .update(erpRuns)
        .set({
          status,
          stoppedBy,
          counts: run.counts,
          problems: run.problems,
          calls: run.meter.calls,
          finishedAt: now,
        })
        .where(and(eq(erpRuns.tenantId, run.tenantId), eq(erpRuns.id, run.id)));
      await tx
        .update(erpConnections)
        .set({
          lastRunAt: now,
          callsDay: today,
          callsUsed: run.meter.used,
          ...(stoppedBy === 'reconnect' ? { status: 'needs_reconnect' } : {}),
        })
        .where(
          and(eq(erpConnections.tenantId, run.tenantId), eq(erpConnections.id, run.connection.id)),
        );
      // A run is audited when it wrote or failed; a quiet hour leaves only its run row.
      if (wrote > 0 || status === 'failed') {
        await this.audit.record(tx, run.tenantId, userActor(run.access), {
          action: 'erp.run',
          target: { type: 'erp_run', id: run.id },
          after: { status, stoppedBy, counts: run.counts, problems: run.problems.length },
        });
      }
    });
  }

  private async close(
    tenantId: string,
    runId: string,
    status: 'failed',
    stoppedBy: ErpRunResult['stoppedBy'],
  ) {
    await this.database.forTenant(tenantId, (tx) =>
      tx
        .update(erpRuns)
        .set({ status, stoppedBy, finishedAt: new Date() })
        .where(and(eq(erpRuns.tenantId, tenantId), eq(erpRuns.id, runId))),
    );
  }
}
