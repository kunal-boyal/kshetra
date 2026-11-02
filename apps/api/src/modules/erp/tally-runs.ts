import { Injectable } from '@nestjs/common';
import {
  type ErpEntity,
  type ErpIssue,
  type ErpMapped,
  type ErpRow,
  type ErpSettings,
  type TallyMapping,
  tallyCustomerRow,
  tallyInvoiceRow,
  tallyItemCode,
  tallyItemRow,
  tallyPriceOn,
  tallyReceiptRow,
  tallyUnder,
  tallyVoucherKind,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { erpConnections, erpRuns } from '../../db/schema/erp';
import { Database } from '../../platform/database';
import { MediaService } from '../media/media.service';
import type { ConnectionRow } from './erp-connections.service';
import { readTallyFile, type TallyFileContents } from './tally-file';

/** A record of the file, mapped to a row of an import target, or why it isn't. */
export interface TallyCandidate {
  externalId: string;
  /** Its name in Tally, by which vouchers and the orders file refer to it. */
  externalName?: string | null;
  label: string;
  modified: string | null;
  mapped: ErpMapped;
  localKey: (row: ErpRow) => string;
}

export interface KitLink {
  localKey: string | null;
  externalName?: string | null;
}

/** What a run offers the steps that read a file: the same settling Zoho's and SAP's records get. */
export interface RunKit {
  settle(
    entity: ErpEntity,
    target: string,
    links: Map<string, KitLink>,
    candidates: readonly TallyCandidate[],
  ): Promise<void>;
  links(entity: ErpEntity): Promise<Map<string, KitLink>>;
  counts(entity: ErpEntity): { read: number };
  problem(entity: ErpEntity, externalId: string, label: string, issue: ErpIssue): void;
  /** A price list's name, as the items import names lists. */
  listName(id: string | null): Promise<string>;
  /** Each account's present territory code, by account code. */
  territoryCodes(codes: string[]): Promise<Map<string, string>>;
  /** Marks the orders the books show by their numbers as in the books. */
  confirmOrders(numbers: ReadonlySet<string>): Promise<void>;
}

type Structure = NonNullable<ConnectionRow['structure']>;

/**
 * Reads a file exported from Tally into the tenant's records (module M20, BR-61, decision D129):
 * its groups and voucher types join what earlier files showed; then customers, stock items with
 * their price levels, sales vouchers and receipts, in that order so references resolve. A file
 * holds what the admin exported, so nothing is filtered by date.
 */
@Injectable()
export class TallyReads {
  constructor(
    private readonly database: Database,
    private readonly media: MediaService,
  ) {}

  /** The file a run was asked to read, as Tally wrote it; refusals are `TallyFileRefused`. */
  async file(tenantId: string, runId: string): Promise<TallyFileContents> {
    const bytes = await this.database.forTenant(tenantId, async (tx) => {
      const [run] = await tx
        .select({ fileMediaId: erpRuns.fileMediaId })
        .from(erpRuns)
        .where(and(eq(erpRuns.tenantId, tenantId), eq(erpRuns.id, runId)));
      if (!run?.fileMediaId) throw new Error(`Run ${runId} has no file.`);
      return (await this.media.read(tx, tenantId, run.fileMediaId)).bytes;
    });
    return readTallyFile(bytes);
  }

  async read(
    connection: ConnectionRow,
    settings: ErpSettings,
    file: TallyFileContents,
    kit: RunKit,
    today: string,
  ): Promise<void> {
    const structure = await this.remember(connection, file);
    const groups = new Map(Object.entries(structure.groups ?? {}));
    const types = new Map(Object.entries(structure.voucherTypes ?? {}));
    const mapping: TallyMapping = {
      accountType: settings.accountType,
      territoryField: null,
      defaultTerritory: settings.defaultTerritory,
      units: settings.units,
      debtorGroups: settings.debtorGroups,
      groupTerritories: settings.groupTerritories,
      defaultTaxRate: settings.defaultTaxRate,
      salesTypes: settings.salesTypes,
      receiptTypes: settings.receiptTypes,
    };
    if (settings.read.customers) await this.customers(file, mapping, groups, kit);
    if (settings.read.items) await this.items(file, mapping, settings, kit, today);
    if (settings.read.invoices || settings.read.payments) {
      await this.vouchers(file, mapping, settings, types, kit);
    }
    // Our orders as Tally holds them: its sales orders whose reference is our number.
    const orders = new Set(
      file.vouchers
        .filter((voucher) => voucher.reference && !voucher.cancelled)
        .filter((voucher) => tallyUnder(voucher.type, [settings.orderType], types))
        .map((voucher) => voucher.reference),
    );
    if (orders.size > 0) await kit.confirmOrders(orders);
  }

  /** Each group's and voucher type's parent, from this file over those before it. */
  private async remember(connection: ConnectionRow, file: TallyFileContents) {
    const before: Structure = connection.structure ?? {};
    const structure = {
      groups: {
        ...before.groups,
        ...Object.fromEntries(file.groups.map((group) => [group.name, group.parent])),
      },
      voucherTypes: {
        ...before.voucherTypes,
        ...Object.fromEntries(file.voucherTypes.map((type) => [type.name, type.parent])),
      },
    };
    if (file.groups.length > 0 || file.voucherTypes.length > 0) {
      await this.database.forTenant(connection.tenantId, (tx) =>
        tx
          .update(erpConnections)
          .set({ structure })
          .where(
            and(
              eq(erpConnections.tenantId, connection.tenantId),
              eq(erpConnections.id, connection.id),
            ),
          ),
      );
    }
    return structure;
  }

  private async customers(
    file: TallyFileContents,
    mapping: TallyMapping,
    groups: ReadonlyMap<string, string>,
    kit: RunKit,
  ) {
    const links = await kit.links('account');
    const codes = file.ledgers.flatMap((ledger) => ledger.aliases);
    const present = codes.length > 0 ? await kit.territoryCodes(codes) : new Map<string, string>();
    const candidates = file.ledgers.flatMap((ledger): TallyCandidate[] => {
      const code = ledger.aliases.find((alias) => present.has(alias)) ?? null;
      const mapped = tallyCustomerRow(ledger, mapping, groups, code ? present.get(code)! : null);
      if (!mapped) return [];
      return [
        {
          externalId: ledger.guid || ledger.name,
          externalName: ledger.name,
          label: ledger.name,
          modified: ledger.alterId || null,
          mapped,
          localKey: (row) => row.code!,
        },
      ];
    });
    kit.counts('account').read += candidates.length;
    await kit.settle('account', `accounts:${mapping.accountType ?? ''}`, links, candidates);
  }

  private async items(
    file: TallyFileContents,
    mapping: TallyMapping,
    settings: ErpSettings,
    kit: RunKit,
    today: string,
  ) {
    if (file.stockItems.length === 0) return;
    const candidates: TallyCandidate[] = file.stockItems.map((item) => ({
      externalId: item.guid || item.name,
      externalName: item.name,
      label: tallyItemCode(item) ?? item.name,
      modified: item.alterId || null,
      mapped: tallyItemRow(item, mapping, today, { level: null, list: '' }),
      localKey: (row) => row.item_code!,
    }));
    kit.counts('item').read += candidates.length;
    await kit.settle('item', 'items', await kit.links('item'), candidates);
    // Each mapped price level into one of the tenant's price lists, at its rate today.
    const priceLinks = await kit.links('price');
    for (const { pricebookId: level, priceList } of settings.priceBooks) {
      const list = await kit.listName(priceList);
      const prices = file.stockItems.flatMap((item): TallyCandidate[] => {
        // An item without a rate at this level isn't priced in it.
        if (tallyPriceOn(item, level, today) === null) return [];
        const mapped = tallyItemRow(item, mapping, today, { level, list });
        return [
          {
            externalId: `${level}:${item.guid || item.name}`,
            externalName: null,
            label: `${level}: ${tallyItemCode(item) ?? item.name}`,
            modified: null,
            mapped,
            localKey: (row) => `${priceList}:${row.item_code}`,
          },
        ];
      });
      kit.counts('price').read += prices.length;
      await kit.settle('price', 'items', priceLinks, prices);
    }
  }

  /** Sales vouchers as invoices and receipt vouchers as receipts, of customers already linked. */
  private async vouchers(
    file: TallyFileContents,
    mapping: TallyMapping,
    settings: ErpSettings,
    types: ReadonlyMap<string, string>,
    kit: RunKit,
  ) {
    if (file.vouchers.length === 0) return;
    // A customer's account code by its ledger's name, as vouchers name their party.
    const codes = new Map(
      [...(await kit.links('account')).values()].flatMap((link) =>
        link.localKey && link.externalName ? [[link.externalName, link.localKey] as const] : [],
      ),
    );
    const sales: TallyCandidate[] = [];
    const receipts: TallyCandidate[] = [];
    for (const voucher of file.vouchers) {
      const kind = tallyVoucherKind(voucher, mapping, types);
      const code = codes.get(voucher.party) ?? null;
      const candidate = {
        externalId: voucher.guid || `${voucher.type}:${voucher.number}`,
        externalName: null,
        label: voucher.number || voucher.guid,
        modified: null,
        localKey: (row: ErpRow) => row.number!,
      };
      if (kind === 'sale' && settings.read.invoices) {
        sales.push({ ...candidate, mapped: tallyInvoiceRow(voucher, code) });
      } else if (kind === 'receipt' && settings.read.payments) {
        receipts.push({ ...candidate, mapped: tallyReceiptRow(voucher, code) });
      }
    }
    kit.counts('invoice').read += sales.length;
    await kit.settle('invoice', 'invoices', await kit.links('invoice'), sales);
    kit.counts('receipt').read += receipts.length;
    await kit.settle('receipt', 'receipts', await kit.links('receipt'), receipts);
  }
}
