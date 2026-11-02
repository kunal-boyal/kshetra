import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  customerRow,
  type ErpEntity,
  type ErpIssue,
  type ErpMapped,
  type SapBusinessPartner,
  sapCustomerRow,
  type SapInvoice,
  sapInvoiceRow,
  type SapItem,
  sapItemRow,
  sapOrderFor,
  type SapMapping,
  type SapPayment,
  sapPaymentRow,
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
  salesOrderFor,
  tallyImportFile,
  tallyOrderFor,
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
import { Queues } from '../../platform/queues';
import { CONFIG } from '../../platform/tokens';
import { AccountsService } from '../accounts/accounts.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { People } from '../iam/people';
import { PriceListsService } from '../catalogue/price-lists.service';
import { MediaService } from '../media/media.service';
import { ImportRefused, type ImportRow, ImportTargets } from '../imports/targets';
import {
  type ConnectionRow,
  credentialsAt,
  ErpConnectionsService,
  PUSH,
  sealedAt,
} from './erp-connections.service';
import { CallMeter, ErpDailyLimit, ErpFailed, ErpRateLimited, ErpReconnect } from './erp-calls';
import { type SapSession, SapB1 } from './sap-b1';
import { TallyFileRefused } from './tally-file';
import { type RunKit, TallyReads } from './tally-runs';
import { ZohoBooks, type ZohoLink } from './zoho-books';

/** Rows committed in one transaction. */
const BATCH = 500;
/** Problems kept a run, so a run over a broken mapping stays readable. */
const PROBLEMS_KEPT = 200;
const DAY_MS = 86_400_000;
/** Nobody, for asking who holds a permission with no one left out. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
/** Providers by name, as their own brands write them in any language. */
const PROVIDER_NAMES: Record<string, string> = {
  zoho_books: 'Zoho Books',
  sap_b1: 'SAP Business One',
  tally: 'Tally',
};
/** Orders sent in one run; the rest go in the next. */
const PUSH_BATCH = 100;
/** An order Tally's Day Book shows as its own sales order. */
const IN_BOOKS = 'in_books';
/** Orders in one Tally file; the rest go in the next. */
const TALLY_FILE_BATCH = 500;

type Counts = NonNullable<ErpRunResult['counts'][ErpEntity]>;

/** A record read from the books, mapped to a row of an import target, or why it isn't. */
interface Candidate {
  externalId: string;
  /** Tally: its name there, by which vouchers refer to it. */
  externalName?: string | null;
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
  externalName?: string | null;
  fingerprint: string | null;
  externalModified: string | null;
}

/** Everything a run carries from step to step. */
interface Run {
  id: string;
  tenantId: string;
  connection: ConnectionRow;
  access: Access;
  /** Zoho's link, or null for another provider. */
  link: ZohoLink;
  /** SAP's signed-in session, or null for another provider. */
  sap: SapSession | null;
  meter: CallMeter;
  settings: ErpSettings;
  mapping: SapMapping;
  /** The day each kind of record has been read through, moved as each step completes (SAP). */
  cursors: Partial<Record<string, string>>;
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
export class ErpRuns {
  private readonly logger = new Logger(ErpRuns.name);

  constructor(
    private readonly database: Database,
    private readonly connections: ErpConnectionsService,
    private readonly zoho: ZohoBooks,
    private readonly sapB1: SapB1,
    private readonly resolver: AccessResolver,
    private readonly targets: ImportTargets,
    private readonly accounts: AccountsService,
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly people: People,
    private readonly queues: Queues,
    private readonly priceLists: PriceListsService,
    private readonly cipher: ColumnCipher,
    private readonly audit: AuditLog,
    private readonly tally: TallyReads,
    private readonly media: MediaService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * The hourly read of each of a tenant's connections (no `connectionId`), or one connection's, or
   * Sync now's (`runId`); a connection that doesn't work is skipped.
   */
  async pull(tenantId: string, connectionId: string | null, runId: string | null): Promise<void> {
    if (connectionId) return this.go(tenantId, connectionId, runId, 'pull');
    const all = await this.database.forTenant(tenantId, (tx) => this.connections.all(tx, tenantId));
    for (const connection of all) {
      // Tally is read only from the files uploaded, each its own run.
      if (connection.status === 'connected' && connection.provider !== 'tally') {
        await this.go(tenantId, connection.id, null, 'pull');
      }
    }
  }

  /**
   * Sends accepted orders to the books (BR-59), soon after they are accepted and after each hourly
   * read, for every order still waiting: one run at a time for a connection, so a push that finds
   * one under way comes back a minute later.
   */
  push(
    tenantId: string,
    connectionId: string | null,
    runId: string | null = null,
    again: string | null = null,
  ): Promise<void> {
    return this.go(tenantId, connectionId, runId, 'push', again);
  }

  /** Asks for a push of what is waiting, once a minute at most for a connection. */
  async schedulePush(tenantId: string, connectionId: string, delayMs = 30_000): Promise<void> {
    const minute = Math.floor((Date.now() + delayMs) / 60_000);
    await this.queues.add(
      'connectors',
      PUSH,
      { tenantId, connectionId },
      { jobId: `erp-push-${connectionId}-${minute}`, delay: delayMs },
    );
  }

  private async go(
    tenantId: string,
    connectionId: string | null,
    runId: string | null,
    kind: 'pull' | 'push',
    again: string | null = null,
  ): Promise<void> {
    const connection = await this.database.forTenant(tenantId, (tx) =>
      connectionId
        ? this.connections.byId(tx, tenantId, connectionId).catch(() => undefined)
        : this.connections.row(tx, tenantId),
    );
    if (!connection) return;
    const settings = ErpSettings.parse(connection.settings);
    const sap = connection.provider === 'sap_b1';
    const tally = connection.provider === 'tally';
    if (kind === 'push' && !tally && !settings.pushOrders) return;
    // Tally is reached by no one: a run reads the file uploaded, or writes the orders file asked for.
    if (tally && !runId) return;
    const ready =
      connection.status === 'connected' &&
      (tally ||
        (sap
          ? connection.endpoint &&
            connection.companyDb &&
            connection.username &&
            connection.credentialsSealed
          : connection.refreshTokenSealed &&
            connection.organizationId &&
            connection.accountsServer &&
            connection.apiDomain));
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
    // A closed module, a read-only or moving tenant, or no working connection: nothing to do.
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
          kind,
          status: 'running',
        });
        return fresh;
      }));
    if (!id) {
      if (kind === 'push') await this.schedulePush(tenantId, connection.id, 60_000);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const run: Run = {
      id,
      tenantId,
      connection,
      access,
      link:
        sap || tally
          ? (null as unknown as ZohoLink)
          : {
              connectionId: connection.id,
              accountsServer: connection.accountsServer!,
              apiDomain: connection.apiDomain!,
              refreshToken: this.cipher.open(
                connection.refreshTokenSealed!,
                sealedAt(connection.id),
              ),
              organizationId: connection.organizationId,
            },
      sap: null,
      // SAP's Service Layer keeps no daily or per-minute limit of its own, and Tally isn't called.
      meter:
        sap || tally
          ? new CallMeter(0, Number.POSITIVE_INFINITY, undefined, Number.POSITIVE_INFINITY)
          : new CallMeter(
              connection.callsDay === today ? connection.callsUsed : 0,
              settings.dailyCalls,
            ),
      settings,
      mapping: {
        accountType: settings.accountType,
        territoryField: settings.territoryField,
        defaultTerritory: settings.defaultTerritory,
        units: settings.units,
        taxRateField: settings.taxRateField,
        defaultTaxRate: settings.defaultTaxRate,
      },
      cursors: { ...connection.cursors },
      full: runId !== null,
      counts: {},
      problems: [],
      items: new Map(),
    };

    let stoppedBy: ErpRunResult['stoppedBy'] = null;
    try {
      if (tally && kind === 'push') {
        await this.tallyOrders(run, again, today);
      } else if (tally) {
        const file = await this.tally.file(tenantId, id);
        await this.tally.read(connection, settings, file, this.kit(run), today);
      } else if (sap) {
        run.sap = await this.sapB1.signIn(
          {
            connectionId: connection.id,
            root: connection.endpoint!,
            companyDb: connection.companyDb!,
            username: connection.username!,
            password: this.cipher.open(connection.credentialsSealed!, credentialsAt(connection.id)),
          },
          run.meter,
        );
        if (kind === 'push') {
          await this.sapOrders(run);
        } else {
          if (settings.read.customers) await this.sapCustomers(run, today);
          if (settings.read.items) await this.sapItems(run, today);
          if (settings.read.invoices) await this.sapInvoices(run, today);
          if (settings.read.payments) await this.sapPayments(run, today);
        }
      } else if (kind === 'push') {
        await this.orders(run);
      } else {
        if (settings.read.customers) await this.customers(run);
        if (settings.read.items) {
          await this.items(run);
          await this.priceBooks(run);
        }
        if (settings.read.invoices) await this.invoices(run);
        if (settings.read.payments) await this.payments(run);
      }
    } catch (error) {
      if (error instanceof TallyFileRefused) stoppedBy = 'bad_file';
      else if (error instanceof ErpDailyLimit) stoppedBy = 'daily_limit';
      else if (error instanceof ErpRateLimited) stoppedBy = 'rate_limited';
      else if (error instanceof ErpReconnect) stoppedBy = 'reconnect';
      else {
        stoppedBy = 'error';
        if (!(error instanceof ErpFailed)) reportError(error, { tenantId, job: `erp.${kind}` });
        this.logger.warn(
          `An ERP ${kind} for ${tenantId} stopped: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    if (run.sap) await this.sapB1.signOut(run.sap);
    await this.finish(run, stoppedBy, today);
    // Orders accepted while the books were out of reach, or whose records have just come in.
    if (kind === 'pull' && !tally && settings.pushOrders && !stoppedBy) {
      await this.schedulePush(tenantId, connection.id, 0);
    }
  }

  /**
   * Each accepted order since the connection was made that the books don't hold yet, oldest
   * first: looked for by its number before it is created, so a lost answer never makes two.
   */
  private async orders(run: Run): Promise<void> {
    const counts = this.counts(run, 'order');
    const waiting = await this.waitingOrders(run);
    if (waiting.length === 0) return;
    const customerOf = this.byLocalKey(await this.links(run, 'account'));
    const itemOf = this.byLocalKey(await this.links(run, 'item'));
    for (const { id, order } of waiting) {
      counts.read += 1;
      const label = `#${order.number}`;
      const mapped = salesOrderFor(
        order,
        customerOf.get(order.accountCode) ?? null,
        (code) => itemOf.get(code) ?? null,
      );
      if ('nothing' in mapped) {
        counts.unchanged += 1;
        continue;
      }
      if ('missing' in mapped) {
        counts.skipped += 1;
        this.problem(run, 'order', id, label, 'not_in_books', {
          field: null,
          detail: mapped.missing.join(', '),
        });
        continue;
      }
      const reference = mapped.body.reference_number;
      let externalId: string | null = null;
      for await (const page of this.zoho.list<{ salesorder_id: string; reference_number?: string }>(
        run.link,
        run.meter,
        'salesorders',
        'salesorders',
        { reference_number: reference },
      )) {
        externalId =
          page.find((found) => found.reference_number === reference)?.salesorder_id ?? null;
        break;
      }
      if (externalId) {
        counts.unchanged += 1;
      } else {
        try {
          const made = await this.zoho.post(run.link, run.meter, 'salesorders', mapped.body);
          externalId = String((made.salesorder as { salesorder_id: string }).salesorder_id);
          counts.created += 1;
        } catch (error) {
          if (!(error instanceof ErpFailed)) throw error;
          counts.skipped += 1;
          this.problem(run, 'order', id, label, 'refused', { field: null, detail: error.message });
          continue;
        }
      }
      await this.database.forTenant(run.tenantId, (tx) =>
        this.saveLinks(tx, run, 'order', [
          {
            externalId: externalId!,
            link: { localKey: id, fingerprint: null, externalModified: null },
          },
        ]),
      );
    }
  }

  /**
   * Accepted orders the company supplies since the connection was made that the books don't hold
   * yet, oldest first, a batch at a time, with their account's code.
   */
  private async waitingOrders(run: Run, batch = PUSH_BATCH, again: readonly string[] = []) {
    const sent = await this.links(run, 'order');
    const sentOrders = new Set([...sent.values()].map((link) => link.localKey));
    return this.database.forTenant(run.tenantId, async (tx) => {
      const ids = (
        await this.ordersService.acceptedSince(tx, run.tenantId, run.connection.createdAt, 500)
      ).filter((id) => !sentOrders.has(id));
      const found = await this.ordersService.forErp(tx, run.tenantId, [
        ...again,
        ...ids.slice(0, batch),
      ]);
      const accounts = await this.accounts.refs(
        tx,
        run.tenantId,
        [...found.values()].map((order) => order.accountId),
      );
      return [...found].map(([id, order]) => ({
        id,
        order: { ...order, accountCode: accounts.get(order.accountId)?.code ?? '' },
      }));
    });
  }

  /**
   * SAP's sales orders (BR-60): each waiting order, looked for by its number (`NumAtCard`) before
   * it is created, so a lost answer never makes two; linked as it goes.
   */
  private async sapOrders(run: Run): Promise<void> {
    const counts = this.counts(run, 'order');
    const waiting = await this.waitingOrders(run);
    if (waiting.length === 0) return;
    const customers = new Set((await this.accountCodes(run)).values());
    const items = new Set(this.byLocalKey(await this.links(run, 'item')).keys());
    for (const { id, order } of waiting) {
      counts.read += 1;
      const label = `#${order.number}`;
      const mapped = sapOrderFor(order, customers.has(order.accountCode), (code) =>
        items.has(code),
      );
      if ('nothing' in mapped) {
        counts.unchanged += 1;
        continue;
      }
      if ('missing' in mapped) {
        counts.skipped += 1;
        this.problem(run, 'order', id, label, 'not_in_books', {
          field: null,
          detail: mapped.missing.join(', '),
        });
        continue;
      }
      const reference = mapped.body.NumAtCard.replaceAll("'", "''");
      let externalId: string | null = null;
      for await (const page of this.sapB1.list<{ DocEntry: number; NumAtCard?: string }>(
        run.sap!,
        run.meter,
        'Orders',
        { $filter: `NumAtCard eq '${reference}'` },
      )) {
        const found = page.find((entry) => entry.NumAtCard === mapped.body.NumAtCard);
        externalId = found ? String(found.DocEntry) : null;
        break;
      }
      if (externalId) {
        counts.unchanged += 1;
      } else {
        try {
          const made = await this.sapB1.post(run.sap!, run.meter, 'Orders', mapped.body);
          externalId = String(made.DocEntry);
          counts.created += 1;
        } catch (error) {
          if (!(error instanceof ErpFailed)) throw error;
          counts.skipped += 1;
          this.problem(run, 'order', id, label, 'refused', { field: null, detail: error.message });
          continue;
        }
      }
      await this.database.forTenant(run.tenantId, (tx) =>
        this.saveLinks(tx, run, 'order', [
          {
            externalId: externalId!,
            link: { localKey: id, fingerprint: null, externalModified: null },
          },
        ]),
      );
    }
  }

  /**
   * Tally's orders file (BR-61): each waiting order, and those an earlier file carried when it is
   * named again, as a sales order under the names Tally knows its customer and items by; orders
   * whose customer or an item came from no file wait. The file is kept 7 days, and each order it
   * carries is linked to this run, so no later file carries it unless asked again.
   */
  private async tallyOrders(run: Run, again: string | null, today: string): Promise<void> {
    const counts = this.counts(run, 'order');
    const carried = again
      ? [...(await this.links(run, 'order')).values()]
          .filter((link) => link.externalModified === again && link.localKey)
          .map((link) => link.localKey!)
      : [];
    const waiting = await this.waitingOrders(run, TALLY_FILE_BATCH, carried);
    const named = (links: Map<string, Link>) =>
      new Map(
        [...links.values()].flatMap((link) =>
          link.localKey && link.externalName ? [[link.localKey, link.externalName] as const] : [],
        ),
      );
    const parties = named(await this.links(run, 'account'));
    const items = named(await this.links(run, 'item'));
    const vouchers: string[] = [];
    const sent: { externalId: string; link: Link }[] = [];
    for (const { id, order } of waiting) {
      counts.read += 1;
      const mapped = tallyOrderFor(
        id,
        order,
        parties.get(order.accountCode) ?? null,
        (code) => items.get(code) ?? null,
        run.settings.orderType,
      );
      if ('nothing' in mapped) {
        counts.unchanged += 1;
        continue;
      }
      if ('missing' in mapped) {
        counts.skipped += 1;
        this.problem(run, 'order', id, `#${order.number}`, 'not_in_books', {
          field: null,
          detail: mapped.missing.join(', '),
        });
        continue;
      }
      counts.created += 1;
      vouchers.push(mapped.voucher);
      sent.push({
        externalId: id,
        link: {
          localKey: id,
          externalName: String(order.number),
          fingerprint: null,
          externalModified: run.id,
        },
      });
    }
    if (vouchers.length === 0) return;
    const fileName = `tally-orders-${today}.xml`;
    await this.database.forTenant(run.tenantId, async (tx) => {
      const file = await this.media.store(tx, run.tenantId, {
        kind: 'export_file',
        fileName,
        contentType: 'application/xml',
        bytes: new TextEncoder().encode(tallyImportFile(run.connection.organizationName, vouchers)),
        userId: null,
        ownerType: 'erp_run',
        ownerId: run.id,
        retentionClass: 'export_file',
        download: true,
      });
      await tx
        .update(erpRuns)
        .set({ fileMediaId: file.id, fileName })
        .where(and(eq(erpRuns.tenantId, run.tenantId), eq(erpRuns.id, run.id)));
      await this.saveLinks(tx, run, 'order', sent);
    });
  }

  /** What a Tally run's steps use of this run: the same settling every provider's records get. */
  private kit(run: Run): RunKit {
    return {
      settle: (entity, target, links, candidates) =>
        this.settle(run, entity, target, links as Map<string, Link>, candidates),
      links: (entity) => this.links(run, entity),
      counts: (entity) => this.counts(run, entity),
      problem: (entity, externalId, label, issue) =>
        this.problem(run, entity, externalId, label, issue),
      listName: (id) => this.listName(run, id),
      territoryCodes: (codes) =>
        this.database.forTenant(run.tenantId, (tx) =>
          this.accounts.territoryCodes(tx, run.tenantId, codes),
        ),
      confirmOrders: (numbers) => this.confirmOrders(run, numbers),
    };
  }

  /**
   * Orders a Day Book shows as Tally's own sales orders, by the number they carry as their
   * reference, are marked in the books; each counts once.
   */
  private async confirmOrders(run: Run, numbers: ReadonlySet<string>): Promise<void> {
    const counts = this.counts(run, 'order');
    const found = [...(await this.links(run, 'order'))].filter(
      ([, link]) => link.externalName && numbers.has(link.externalName),
    );
    counts.read += found.length;
    const fresh = found.filter(([, link]) => link.fingerprint !== IN_BOOKS);
    counts.unchanged += found.length - fresh.length;
    counts.updated += fresh.length;
    if (fresh.length === 0) return;
    await this.database.forTenant(run.tenantId, (tx) =>
      this.saveLinks(
        tx,
        run,
        'order',
        fresh.map(([externalId, link]) => ({
          externalId,
          link: { ...link, fingerprint: IN_BOOKS },
        })),
      ),
    );
  }

  /** What each local key is in the books. */
  private byLocalKey(links: Map<string, Link>): Map<string, string> {
    return new Map(
      [...links].flatMap(([externalId, link]) =>
        link.localKey ? [[link.localKey, externalId] as const] : [],
      ),
    );
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
   * SAP's `$filter` for what changed since a kind of record was last read through, a day either
   * side of its cursor so nothing written around midnight is missed; Sync now reads everything.
   */
  private changedSince(run: Run, entity: string): string | null {
    const cursor = run.cursors[entity];
    if (run.full || !cursor) return null;
    const day = new Date(Date.parse(`${cursor}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    return `UpdateDate ge '${day}'`;
  }

  private filterOf(...parts: (string | null)[]): Record<string, string> {
    const filter = parts.filter(Boolean).join(' and ');
    return filter ? { $filter: filter } : {};
  }

  /** SAP's business partners that are customers, as accounts (BR-60). */
  private async sapCustomers(run: Run, today: string): Promise<void> {
    const links = await this.links(run, 'account');
    const counts = this.counts(run, 'account');
    const partners: SapBusinessPartner[] = [];
    for await (const page of this.sapB1.list<SapBusinessPartner>(
      run.sap!,
      run.meter,
      'BusinessPartners',
      this.filterOf("CardType eq 'cCustomer'", this.changedSince(run, 'account')),
    )) {
      partners.push(...page);
    }
    counts.read += partners.length;
    const present = await this.database.forTenant(run.tenantId, (tx) =>
      this.accounts.territoryCodes(
        tx,
        run.tenantId,
        partners.map((partner) => String(partner.CardCode ?? '').trim()).filter(Boolean),
      ),
    );
    await this.settle(
      run,
      'account',
      `accounts:${run.settings.accountType ?? ''}`,
      links,
      partners.map((partner) => ({
        externalId: partner.CardCode,
        label: partner.CardCode,
        modified: partner.UpdateDate ?? null,
        mapped: sapCustomerRow(partner, run.mapping, present.get(partner.CardCode) ?? null),
        localKey: (row) => row.code!,
      })),
    );
    run.cursors.account = today;
  }

  /** SAP's items, and their prices in the price lists the mappings name (BR-60). */
  private async sapItems(run: Run, today: string): Promise<void> {
    const groups = new Map<number, string>();
    for await (const page of this.sapB1.list<{ Number: number; GroupName: string }>(
      run.sap!,
      run.meter,
      'ItemGroups',
    )) {
      for (const group of page) groups.set(group.Number, group.GroupName);
    }
    const items: SapItem[] = [];
    for await (const page of this.sapB1.list<SapItem>(
      run.sap!,
      run.meter,
      'Items',
      this.filterOf(this.changedSince(run, 'item')),
    )) {
      items.push(...page);
    }
    this.counts(run, 'item').read += items.length;
    const groupOf = (item: SapItem) =>
      item.ItemsGroupCode === undefined ? null : (groups.get(item.ItemsGroupCode) ?? null);
    await this.settle(
      run,
      'item',
      'items',
      await this.links(run, 'item'),
      items.map((item) => ({
        externalId: item.ItemCode,
        label: item.ItemCode,
        modified: item.UpdateDate ?? null,
        mapped: sapItemRow(item, run.mapping, groupOf(item), { rate: null, list: '' }),
        localKey: (row) => row.item_code!,
      })),
    );
    // Each mapped SAP price list (its number) into one of the tenant's price lists.
    const priceLinks = await this.links(run, 'price');
    for (const { pricebookId, priceList } of run.settings.priceBooks) {
      const listNo = Number(pricebookId);
      const listName = await this.listName(run, priceList);
      const candidates: Candidate[] = items.flatMap((item) => {
        const price = item.ItemPrices?.find((entry) => entry.PriceList === listNo);
        if (!price || price.Price === null || price.Price === undefined) return [];
        return [
          {
            externalId: `${pricebookId}:${item.ItemCode}`,
            label: `${pricebookId}: ${item.ItemCode}`,
            modified: null,
            mapped: sapItemRow(item, run.mapping, groupOf(item), {
              rate: price.Price,
              list: listName,
            }),
            localKey: (row: ErpRow) => `${priceList}:${row.item_code}`,
          },
        ];
      });
      this.counts(run, 'price').read += candidates.length;
      await this.settle(run, 'price', 'items', priceLinks, candidates);
    }
    run.cursors.item = today;
  }

  /** SAP's A/R invoices of the last `invoiceDays`, for customers already linked (BR-51, BR-60). */
  private async sapInvoices(run: Run, today: string): Promise<void> {
    const linked = new Set((await this.accountCodes(run)).values());
    const invoices: SapInvoice[] = [];
    for await (const page of this.sapB1.list<SapInvoice>(
      run.sap!,
      run.meter,
      'Invoices',
      this.filterOf(`DocDate ge '${this.since(run)}'`, this.changedSince(run, 'invoice')),
    )) {
      invoices.push(...page);
    }
    this.counts(run, 'invoice').read += invoices.length;
    await this.settle(
      run,
      'invoice',
      'invoices',
      await this.links(run, 'invoice'),
      invoices.map((invoice) => ({
        externalId: String(invoice.DocEntry),
        label: String(invoice.DocNum),
        modified: invoice.UpdateDate ?? null,
        mapped: sapInvoiceRow(invoice, linked.has(invoice.CardCode)),
        localKey: (row) => row.number!,
      })),
    );
    run.cursors.invoice = today;
  }

  /** SAP's incoming payments, against the invoices they were applied to (BR-51, BR-60). */
  private async sapPayments(run: Run, today: string): Promise<void> {
    const linked = new Set((await this.accountCodes(run)).values());
    const invoiceNumbers = new Map(
      [...(await this.links(run, 'invoice'))].flatMap(([entry, link]) =>
        link.localKey ? [[Number(entry), link.localKey] as const] : [],
      ),
    );
    const payments: SapPayment[] = [];
    for await (const page of this.sapB1.list<SapPayment>(
      run.sap!,
      run.meter,
      'IncomingPayments',
      this.filterOf(`DocDate ge '${this.since(run)}'`, this.changedSince(run, 'receipt')),
    )) {
      payments.push(...page);
    }
    this.counts(run, 'receipt').read += payments.length;
    await this.settle(
      run,
      'receipt',
      'receipts',
      await this.links(run, 'receipt'),
      payments.map((payment) => ({
        externalId: String(payment.DocEntry),
        label: String(payment.DocNum),
        modified: payment.UpdateDate ?? null,
        mapped: sapPaymentRow(
          payment,
          linked.has(payment.CardCode),
          (entry) => invoiceNumbers.get(entry) ?? null,
        ),
        localKey: (row) => row.number!,
      })),
    );
    run.cursors.receipt = today;
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
            externalName: candidate.externalName,
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
          link: {
            localKey: null,
            externalName: candidate.externalName,
            fingerprint: null,
            externalModified: candidate.modified,
          },
        });
        continue;
      }
      holders.set(key, candidate.externalId);
      const print = fingerprint(row);
      // A record renamed in Tally writes nothing new, but its link learns the new name.
      if (
        before?.fingerprint === print &&
        before.localKey === key &&
        (candidate.externalName === undefined || before.externalName === candidate.externalName)
      ) {
        counts.unchanged += 1;
        seen.push({
          externalId: candidate.externalId,
          link: {
            localKey: key,
            externalName: candidate.externalName,
            fingerprint: print,
            externalModified: candidate.modified,
          },
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
      // The books' rows carry only what the books know; the rest stays as the portal set it.
      keepMissing: true,
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
            externalName: entry.candidate.externalName,
            fingerprint: entry.print,
            externalModified: entry.candidate.modified,
          },
        })),
      );
      for (const entry of left) {
        links.set(entry.candidate.externalId, {
          localKey: entry.key,
          externalName: entry.candidate.externalName ?? null,
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
            externalName: link.externalName ?? null,
            fingerprint: link.fingerprint,
            externalModified: link.externalModified,
          })),
        )
        .onConflictDoUpdate({
          target: [erpLinks.tenantId, erpLinks.connectionId, erpLinks.entity, erpLinks.externalId],
          set: {
            localKey: sql`excluded.local_key`,
            // A provider that names no records keeps what another run learnt.
            externalName: sql`coalesce(excluded.external_name, ${erpLinks.externalName})`,
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
          externalName: erpLinks.externalName,
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
      stoppedBy === 'reconnect' || stoppedBy === 'error' || stoppedBy === 'bad_file'
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
          cursors: run.cursors,
          ...(stoppedBy === 'reconnect' ? { status: 'needs_reconnect' } : {}),
        })
        .where(
          and(eq(erpConnections.tenantId, run.tenantId), eq(erpConnections.id, run.connection.id)),
        );
      // The books refused the agreement: whoever may connect them hears, once a day.
      if (stoppedBy === 'reconnect') {
        for (const userId of await this.people.holding(tx, run.tenantId, 'erp.manage', NOBODY)) {
          await this.notifications.notify(tx, run.tenantId, {
            userId,
            event: 'erp.reconnect',
            values: {
              provider: PROVIDER_NAMES[run.connection.provider] ?? run.connection.provider,
            },
            link: '/settings/erp',
            dedupeKey: `erp-reconnect:${run.connection.id}:${today}`,
          });
        }
      }
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
