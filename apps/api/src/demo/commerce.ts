import {
  type ApprovalResult,
  FinanceSnapshotBody,
  type GeoPoint,
  type ItemResult,
  LedgerEntriesBody,
  newId,
  PlaceOrderBody,
  PriceListBody,
  scaled,
  unscaled,
} from '@thelamp/shared';
import { CatalogueService } from '../modules/catalogue/catalogue.service';
import { PriceListsService } from '../modules/catalogue/price-lists.service';
import { FinanceService } from '../modules/finance/finance.service';
import { OrdersService } from '../modules/orders/orders.service';
import { TenantConfigService } from '../modules/tenant-config/tenant-config.service';
import { ApprovalsService } from '../modules/workflow/approvals.service';
import { userActor } from '../platform/audit';
import { addDays, type DemoKit, type FieldPerson, type Person, type Place } from './kit';
import { personType } from './names';

/** An order the demo follows until it is delivered or turned down. */
interface Followed {
  id: string;
  accountId: string;
  /** Whether the company supplies it, so it lands on the account's statement. */
  company: boolean;
  placedOn: string;
}

/**
 * The commerce side of the demo (phase 2, decision D86): the company's price lists, orders taken
 * at visits, their decisions along the order chain, deliveries, and the statements of the accounts
 * the company supplies, with invoices, payments and a balance at each week's end. Everything goes
 * through the services as the person who would do it.
 */
export class DemoCommerce {
  private items: ItemResult[] = [];
  /** Account types whose accounts take orders: those that supply others, and those supplied. */
  private orderTypes = new Set<string>();
  private suppliers: Place[] = [];
  private readonly followed: Followed[] = [];
  /** What each supplied account owes, in paise. */
  private readonly owed = new Map<string, bigint>();
  private readonly limits = new Map<string, string>();
  private counts = { orders: 0, deliveries: 0 };

  constructor(private readonly kit: DemoKit) {}

  get made() {
    return this.counts;
  }

  /** Price lists for the catalogue, and an opening balance for each account the company supplies. */
  async setUp(admin: Person, team: FieldPerson[], first: string): Promise<void> {
    const { kit } = this;
    this.items = (await kit.tx((tx) => kit.get(CatalogueService).items(tx, kit.tenantId))).filter(
      (item) => item.active,
    );
    if (this.items.length === 0) return;
    // People, such as doctors at a hospital, belong to their parent but buy nothing from it.
    const places = team.flatMap((person) => person.places);
    const buyers = places.filter((place) => place.parentId && !personType(place.type));
    const supplierIds = new Set(buyers.map((place) => place.parentId!));
    this.suppliers = places.filter((place) => supplierIds.has(place.id));
    const supplierTypes = new Set(this.suppliers.map((place) => place.type));
    this.orderTypes = new Set([...supplierTypes, ...buyers.map((place) => place.type)]);

    const lists = kit.get(PriceListsService);
    const actor = userActor(admin.access);
    const price = (item: ItemResult, share: number) =>
      unscaled((scaled(item.mrp ?? '500', 2) * BigInt(Math.round(share * 100))) / 100n, 2);
    const add = async (
      name: string,
      body: Partial<PriceListBody>,
      share: number,
    ): Promise<void> => {
      const id = newId();
      try {
        const { list } = await kit.tx((tx) =>
          lists.put(
            tx,
            kit.tenantId,
            actor,
            id,
            PriceListBody.parse({
              name,
              scope: 'default',
              validFrom: addDays(first, -30),
              ...body,
            }),
          ),
        );
        await kit.tx((tx) =>
          lists.setItems(tx, kit.tenantId, actor, id, {
            set: this.items.map((item, index) => ({
              itemId: item.id,
              price: price(item, share),
              discount: index % 4 === 1 ? '5' : '0',
            })),
            remove: [],
            version: list.version,
          }),
        );
      } catch (error) {
        kit.once(`price list ${name}`, error);
      }
    };
    await add('Standard rates', {}, 0.78);
    if (supplierTypes.size > 0) {
      await add(
        'Distributor rates',
        { scope: 'account_type', targets: [...supplierTypes], priority: 10 },
        0.68,
      );
    }

    // What each account the company supplies brought forward, and its credit limit.
    const opening = addDays(first, -1);
    for (const place of this.suppliers) {
      const amount = BigInt(this.kit.dice.int(40, 160)) * 1_000_00n;
      this.limits.set(place.id, String(this.kit.dice.pick([300_000, 400_000, 500_000])));
      await this.entries(admin, [
        {
          accountId: place.id,
          date: opening,
          reference: `OPEN-${place.id}`,
          description: 'Balance brought forward',
          debit: unscaled(amount, 2),
        },
      ]);
      await this.snapshot(admin, place.id, opening);
    }
  }

  /** Whether the person takes an order at a place, now and then; true when one was placed. */
  async atVisit(
    person: FieldPerson,
    place: Place,
    visitId: string,
    at: number,
    fix: { location: GeoPoint; accuracy: number; mocked: boolean; capturedAt: string },
  ): Promise<boolean> {
    const { kit } = this;
    if (!this.orderTypes.has(place.type) || !kit.dice.chance(0.45)) return false;
    const date = new Date(at).toISOString().slice(0, 10);
    try {
      const offers = await kit.tx((tx) =>
        kit.get(PriceListsService).forAccount(tx, person.access, place.id, date),
      );
      if (offers.items.length === 0) return false;
      const chosen = kit.dice.shuffle(offers.items).slice(0, kit.dice.int(1, 4));
      const lines = chosen.flatMap((offer) => {
        const item = this.items.find((entry) => entry.id === offer.itemId);
        if (!item) return [];
        const bigger = item.units.find((unit) => unit.key !== item.baseUnit);
        const unit =
          bigger && kit.dice.chance(0.3)
            ? bigger
            : (item.units.find((entry) => entry.key === item.baseUnit) ?? item.units[0]!);
        const quantity = unit === bigger ? kit.dice.int(1, 4) : kit.dice.int(4, 30);
        return [
          {
            itemId: item.id,
            unitKey: unit.key,
            quantity: String(quantity),
            quoted: {
              listId: offer.listId,
              price: offer.price,
              discount: offer.discount,
              taxRate: item.taxRate,
              factor: unit.factor,
            },
          },
        ];
      });
      if (lines.length === 0) return false;
      const placed = await kit.tx((tx) =>
        kit.get(OrdersService).place(
          tx,
          person.access,
          PlaceOrderBody.parse({
            id: newId(),
            accountId: place.id,
            visitId,
            lines,
            fix,
            placedAt: new Date(at).toISOString(),
          }),
        ),
      );
      this.counts.orders++;
      this.followed.push({
        id: placed.id,
        accountId: place.id,
        company: placed.supplier.kind === 'company',
        placedOn: date,
      });
      return true;
    } catch (error) {
      kit.once('order', error);
      return false;
    }
  }

  /**
   * An approver's decision on a waiting order, on the order's own page: line by line where the
   * step decides by line, now and then turning a line or an order down.
   */
  async decide(approver: Person, approval: ApprovalResult): Promise<void> {
    const { kit } = this;
    const orders = kit.get(OrdersService);
    try {
      const waiting = await kit.tx((tx) =>
        kit.get(ApprovalsService).waiting(tx, kit.tenantId, approval.id),
      );
      if (!waiting?.approverIds.includes(approver.id)) return;
      const reasons = await kit.tx((tx) => orders.reasons(tx, kit.tenantId));
      const reason = (key: string) =>
        (reasons.find((entry) => entry.key === key) ?? reasons[0])?.key;
      if (waiting.lineDecisions) {
        const order = await kit.tx((tx) => orders.get(tx, approver.access, approval.requestId));
        const turnedDown = kit.dice.chance(0.15) && order.lines.length > 1;
        await kit.tx((tx) =>
          orders.decideLines(tx, approver.access, approval.requestId, {
            lines: order.lines.map((line, index) =>
              turnedDown && index === 0
                ? { lineId: line.id, decision: 'rejected', reason: reason('no_stock') }
                : { lineId: line.id, decision: 'accepted' },
            ),
            version: waiting.version,
          }),
        );
      } else if (kit.dice.chance(0.06)) {
        await kit.tx((tx) =>
          orders.decide(tx, approver.access, approval.requestId, {
            decision: 'reject',
            reason: reason('overdue'),
            version: waiting.version,
          }),
        );
      } else {
        await kit.tx((tx) =>
          orders.decide(tx, approver.access, approval.requestId, {
            decision: 'accept',
            version: waiting.version,
          }),
        );
      }
    } catch (error) {
      kit.once('order decision', error);
    }
  }

  /**
   * A week's end at the office: accepted orders are delivered and invoiced, the accounts the
   * company supplies pay part of what they owe, and their balances are taken.
   */
  async weekEnd(admin: Person, date: string): Promise<void> {
    const { kit } = this;
    const orders = kit.get(OrdersService);
    for (const entry of [...this.followed]) {
      if (entry.placedOn >= date) continue;
      try {
        const order = await kit.tx((tx) => orders.get(tx, admin.access, entry.id));
        if (order.status === 'rejected' || order.status === 'cancelled') {
          this.followed.splice(this.followed.indexOf(entry), 1);
          continue;
        }
        if (!order.can.fulfil) continue;
        const accepted = order.lines.filter((line) => line.decision === 'accepted');
        await kit.tx((tx) =>
          orders.fulfil(tx, admin.access, entry.id, {
            action: 'fulfil',
            lines: accepted.map((line) => ({ lineId: line.id, fulfilledUnits: line.baseUnits })),
            version: order.version,
          }),
        );
        this.counts.deliveries++;
        this.followed.splice(this.followed.indexOf(entry), 1);
        if (entry.company) {
          const invoiced = accepted.reduce((sum, line) => sum + scaled(line.total, 2), 0n);
          await this.entries(admin, [
            {
              accountId: entry.accountId,
              date,
              reference: `INV-${entry.id}`,
              description: 'Invoice for delivered order',
              debit: unscaled(invoiced, 2),
            },
          ]);
        }
      } catch (error) {
        kit.once('delivery', error);
      }
    }
    for (const place of this.suppliers) {
      const owed = this.owed.get(place.id) ?? 0n;
      if (owed > 0n) {
        const share = BigInt(kit.dice.int(50, 90));
        const paid = ((owed * share) / 100n / 100_00n) * 100_00n;
        if (paid > 0n) {
          await this.entries(admin, [
            {
              accountId: place.id,
              date,
              reference: `RCPT-${date.replaceAll('-', '')}-${place.id}`,
              description: 'Payment received',
              credit: unscaled(paid, 2),
            },
          ]);
        }
      }
      await this.snapshot(admin, place.id, date);
    }
  }

  /** References are unique across the tenant, so each carries a whole ID, never a part of one. */
  private async entries(
    admin: Person,
    entries: {
      accountId: string;
      date: string;
      reference: string;
      description: string;
      debit?: string;
      credit?: string;
    }[],
  ): Promise<void> {
    const { kit } = this;
    try {
      await kit.tx((tx) =>
        kit.get(FinanceService).addEntries(
          tx,
          admin.access,
          LedgerEntriesBody.parse({
            entries: entries.map((entry) => ({ id: newId(), ...entry })),
          }),
        ),
      );
      for (const entry of entries) {
        const change = scaled(entry.debit ?? '0', 2) - scaled(entry.credit ?? '0', 2);
        this.owed.set(entry.accountId, (this.owed.get(entry.accountId) ?? 0n) + change);
      }
    } catch (error) {
      kit.once('statement', error);
    }
  }

  /** The account's balance as the accounts software would report it, with its ageing. */
  private async snapshot(admin: Person, accountId: string, asOf: string): Promise<void> {
    const { kit } = this;
    const owed = this.owed.get(accountId) ?? 0n;
    const outstanding = owed > 0n ? owed : 0n;
    try {
      const { ageingBuckets } = await kit.tx((tx) =>
        kit.get(TenantConfigService).settings(tx, kit.tenantId),
      );
      const recent = (outstanding * 7n) / 10n;
      const ageing: Record<string, string> = {};
      if (ageingBuckets[0]) ageing[ageingBuckets[0].key] = unscaled(recent, 2);
      if (ageingBuckets[1]) ageing[ageingBuckets[1].key] = unscaled(outstanding - recent, 2);
      await kit.tx((tx) =>
        kit.get(FinanceService).addSnapshot(
          tx,
          admin.access,
          FinanceSnapshotBody.parse({
            id: newId(),
            accountId,
            asOf,
            outstanding: unscaled(outstanding, 2),
            creditLimit: this.limits.get(accountId) ?? null,
            ageing,
            source: 'Accounts office',
          }),
        ),
      );
    } catch (error) {
      kit.once('balance', error);
    }
  }
}
