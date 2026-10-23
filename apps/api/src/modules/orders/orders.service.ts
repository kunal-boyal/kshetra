import { Injectable } from '@nestjs/common';
import type { DayOrder } from '@thelamp/metrics';
import {
  AppError,
  applicableLists,
  type ApprovalSubject,
  DEFAULT_REJECTION_REASONS,
  type ErrorDetail,
  type FulfilmentBody,
  gstHalves,
  issueAt,
  type LineDecision,
  type LineDecisionsBody,
  newId,
  type OrderDecisionBody,
  type OrderListQuery,
  type OrderListResult,
  type OrderResult,
  type OrderStatus,
  orderSizeIssue,
  orderTotals,
  type PlaceOrderBody,
  priceFor,
  priceLine,
  quoteDifferences,
  scaled,
  statusAfterFulfilment,
  statusFromLines,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, asc, count, desc, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { orderLines, orders } from '../../db/schema/orders';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointSql } from '../../platform/geo';
import { onLocalDate } from '../../platform/local-day';
import { Outbox } from '../../platform/outbox';
import { AccountTypesService } from '../accounts/account-types.service';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { ShiftsService } from '../field/shifts.service';
import { VisitsService } from '../field/visits.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { ApprovalsService } from '../workflow/approvals.service';
import { OrderCredit } from './order-credit';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

interface LineSnapshot {
  id: string;
  code: string;
  name: string;
  packLabel: string | null;
  hsn: string | null;
  mrp: string | null;
  baseUnit: string;
}

/**
 * Orders (M10, decision D78). The server prices every order from the price lists that apply to
 * its account on the day it was placed (BR-14), refusing with `PRICE_CHANGED` what the device
 * showed otherwise; each line keeps its item as it was (BR-15). Approval follows the `order`
 * chain, decided on the order's own page: whole, with a configured reason to reject, or line by
 * line at a step that says so. Fulfilment is recorded by back office. A status change never makes
 * an invoice or moves stock (BR-19).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly accountTypes: AccountTypesService,
    private readonly territories: TerritoriesService,
    private readonly catalogue: CatalogueService,
    private readonly priceLists: PriceListsService,
    private readonly shifts: ShiftsService,
    private readonly visits: VisitsService,
    private readonly photos: PhotosService,
    private readonly approvals: ApprovalsService,
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly credit: OrderCredit,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  /** `POST /v1/orders`: prices, checks and keeps an order, then asks for its approval. */
  async place(tx: TenantTx, access: Access, body: PlaceOrderBody): Promise<OrderResult> {
    const { tenantId } = access;
    const settings = await this.config.settings(tx, tenantId);
    const placedAt = Date.parse(body.placedAt);
    if (placedAt > Date.now() + 5 * 60_000) {
      throw invalid([issueAt(['placedAt'], 'This is later than now. Check the phone’s clock')]);
    }

    // Where it was taken: a phone sends a fix; the order desk may not.
    if (access.deviceId && !body.fix) {
      throw invalid([issueAt(['fix'], 'Wait for a location fix')]);
    }
    const shift = await this.shifts.at(tx, tenantId, access.userId, placedAt);
    if (
      access.deviceId &&
      settings.ordersNeedOpenShift &&
      !access.permissions.has('order.create_without_shift') &&
      !shift
    ) {
      throw new AppError('NOT_ON_SHIFT', 'Punch in to take orders.');
    }

    // The account, and who supplies it: its parent, or the company.
    const account = await this.accounts.find(tx, access, body.accountId);
    if (account.status !== 'active') {
      throw invalid([issueAt(['accountId'], 'This account is not active')]);
    }
    const type = (await this.accountTypes.list(tx, tenantId)).find(
      (entry) => entry.id === account.typeId,
    )!;
    const visit = body.visitId ? await this.visits.own(tx, access, body.visitId) : null;
    if (visit && visit.accountId !== account.id) {
      throw invalid([issueAt(['visitId'], 'This visit was at another account')]);
    }

    // BR-14: price every line from the lists that apply on the day it was placed.
    const day = todayIn(settings.timezone, new Date(placedAt));
    const lists = applicableLists(
      await this.priceLists.refs(tx, tenantId),
      {
        id: account.id,
        type: type.key,
        segments: account.segments,
        territories: await this.territories.ancestors(tx, tenantId, account.territoryId),
      },
      day,
    );
    const entries = await this.priceLists.entries(
      tx,
      tenantId,
      lists.map((list) => list.id),
    );
    const { rounding } = await this.catalogue.settings(tx, tenantId);
    const items = new Map(
      (
        await this.catalogue.items(
          tx,
          tenantId,
          body.lines.map((line) => line.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const issues: ErrorDetail[] = [];
    const changed: ErrorDetail[] = [];
    const priced = body.lines.flatMap((line, index) => {
      const item = items.get(line.itemId);
      if (!item || !item.active) {
        issues.push(issueAt(['lines', index, 'itemId'], 'This item can no longer be ordered'));
        return [];
      }
      const unit = item.units.find((entry) => entry.key === line.unitKey);
      if (!unit) {
        issues.push(issueAt(['lines', index, 'unitKey'], 'This item is not sold in this unit'));
        return [];
      }
      const price = priceFor(item.id, lists, (listId, itemId) => entries.get(listId)?.get(itemId));
      if (!price) {
        issues.push(issueAt(['lines', index, 'itemId'], 'No price list prices this item here'));
        return [];
      }
      const current = {
        price: price.price,
        discount: price.discount,
        taxRate: item.taxRate,
        factor: unit.factor,
      };
      for (const field of quoteDifferences(line.quoted, current)) {
        changed.push(issueAt(['lines', index, field], `Now ${current[field]}`));
      }
      return [
        {
          index,
          item,
          unitKey: unit.key,
          quantity: line.quantity,
          listId: price.listId,
          ...current,
          ...priceLine(
            {
              price: price.price,
              discount: price.discount,
              taxRate: item.taxRate,
              quantity: line.quantity,
              factor: unit.factor,
              measurePerBaseUnit: item.measurePerBaseUnit,
            },
            rounding,
          ),
        },
      ];
    });
    if (issues.length > 0) throw invalid(issues);
    if (changed.length > 0) {
      throw new AppError(
        'PRICE_CHANGED',
        'Prices changed since the phone showed them. Refresh and check the order.',
        changed,
      );
    }
    // BR-13: one line an item, at most 200 lines, and a total within the limit.
    const size = orderSizeIssue(
      priced.map((line) => ({ itemId: line.item.id, total: line.total })),
    );
    if (size) {
      throw invalid([
        issueAt(
          ['lines'],
          size === 'repeated_item'
            ? 'Each item appears on one line; add to its quantity instead'
            : size === 'too_many_lines'
              ? 'An order has at most 200 lines'
              : 'This order is too large',
        ),
      ]);
    }
    const totals = orderTotals(priced);
    const photoIds = await this.checkPhotos(tx, access, body.photos, body.id);

    await tx.insert(orders).values({
      id: body.id,
      tenantId,
      accountId: account.id,
      supplierKind: account.parentAccountId ? 'account' : 'company',
      supplierAccountId: account.parentAccountId,
      userId: access.userId,
      deviceId: access.deviceId ?? null,
      visitId: visit?.id ?? null,
      shiftId: shift?.id ?? null,
      placedAt: new Date(placedAt),
      point: body.fix ? pointSql(body.fix.location) : null,
      accuracy: body.fix?.accuracy ?? null,
      subtotal: totals.taxable,
      taxTotal: totals.tax,
      total: totals.total,
      note: body.note,
      photoIds,
    });
    await tx.insert(orderLines).values(
      priced.map((line) => ({
        id: newId(),
        tenantId,
        orderId: body.id,
        position: line.index + 1,
        itemId: line.item.id,
        snapshot: {
          id: line.item.id,
          code: line.item.code,
          name: line.item.name,
          packLabel: line.item.packLabel,
          hsn: line.item.hsn,
          mrp: line.item.mrp,
          baseUnit: line.item.baseUnit,
        } satisfies LineSnapshot,
        priceListId: line.listId,
        unitKey: line.unitKey,
        quantity: line.quantity,
        factor: line.factor,
        baseUnits: line.baseUnits,
        measureType: line.measure === null ? null : line.item.measureType,
        measureTotal: line.measure,
        price: line.price,
        discount: line.discount,
        taxRate: line.taxRate,
        rate: line.rate,
        taxable: line.taxable,
        tax: line.tax,
        total: line.total,
      })),
    );
    await this.photos.attach(tx, tenantId, photoIds, { type: 'order', id: body.id });

    // The order chain (spec 5.9), with the facts its conditions read.
    const overCredit = await this.credit.over(tx, tenantId, account.id, totals.total);
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      access.userId,
      'order',
      body.id,
      userActor(access),
      { accountId: account.id, facts: { total: totals.total, over_credit: overCredit } },
    );
    await tx
      .update(orders)
      .set({ workflowInstanceId: approvalId })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, body.id)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'order.placed',
      target: { type: 'order', id: body.id },
      before: null,
      after: { accountId: account.id, total: totals.total, lines: priced.length },
    });
    await this.outbox.publish(tx, tenantId, 'order.placed', body.id, {
      orderId: body.id,
      userId: access.userId,
      accountId: account.id,
      visitId: visit?.id ?? null,
      placedAt: new Date(placedAt).toISOString(),
      status: 'submitted',
    });
    return this.get(tx, access, body.id);
  }

  /** A photo of the customer's own order: the placer's, uploaded, and not used elsewhere. */
  private async checkPhotos(
    tx: TenantTx,
    access: Access,
    ids: readonly string[],
    orderId: string,
  ): Promise<string[]> {
    if (new Set(ids).size !== ids.length) {
      throw invalid([issueAt(['photos'], 'Each photo can be used once')]);
    }
    const rows = new Map(
      (await this.photos.forRecord(tx, access.tenantId, ids)).map((row) => [row.id, row]),
    );
    const issues: ErrorDetail[] = [];
    ids.forEach((id, index) => {
      const row = rows.get(id);
      if (!row || row.userId !== access.userId || row.kind !== 'attachment') {
        issues.push(issueAt(['photos', index], 'Take this photo again'));
      } else if (row.status === 'pending') {
        throw new AppError('MEDIA_NOT_READY', 'A photo has not finished uploading.', [
          issueAt(['photos', index], 'Still uploading'),
        ]);
      } else if (
        row.status === 'rejected' ||
        row.status === 'deleted' ||
        (row.ownerId && row.ownerId !== orderId)
      ) {
        issues.push(issueAt(['photos', index], 'This photo could not be used. Take it again'));
      }
    });
    if (issues.length > 0) throw invalid(issues);
    return [...ids];
  }

  /**
   * Who sees an order (M10): whoever placed it; with `order.view`, the people over them, those
   * who see its account, and those who see its supplier, so a distributor's people see the
   * orders placed through it.
   */
  private async visible(tx: TenantTx, access: Access): Promise<SQL> {
    const own = eq(orders.userId, access.userId);
    if (!access.permissions.has('order.view'))
      return and(eq(orders.tenantId, access.tenantId), own)!;
    const reach = await this.accounts.reachIds(tx, access);
    return and(
      eq(orders.tenantId, access.tenantId),
      or(
        own,
        sql`${orders.userId} in (${await this.scopes.userIds(tx, access)})`,
        sql`${orders.accountId}::text in ${reach}`,
        sql`${orders.supplierAccountId}::text in ${reach}`,
      ),
    )!;
  }

  private async row(tx: TenantTx, access: Access, id: string, lock = false): Promise<OrderRow> {
    const query = tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, access.tenantId), eq(orders.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    const [seen] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, id), await this.visible(tx, access)));
    if (!seen) throw outOfScope();
    return row;
  }

  async list(tx: TenantTx, access: Access, query: OrderListQuery): Promise<OrderListResult> {
    const { tenantId } = access;
    const { timezone } = await this.config.settings(tx, tenantId);
    const dayStart = (date: string) => sql`(${date}::date::timestamp at time zone ${timezone})`;
    let after: SQL | undefined;
    if (query.cursor) {
      const [at] = await tx
        .select({ placedAt: orders.placedAt })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, query.cursor)));
      if (at) {
        after = or(
          lt(orders.placedAt, at.placedAt),
          and(eq(orders.placedAt, at.placedAt), lt(orders.id, query.cursor)),
        );
      }
    }
    const rows = await tx
      .select({
        id: orders.id,
        accountId: orders.accountId,
        userId: orders.userId,
        placedAt: orders.placedAt,
        status: orders.status,
        total: orders.total,
      })
      .from(orders)
      .where(
        and(
          await this.visible(tx, access),
          query.status ? eq(orders.status, query.status) : undefined,
          query.accountId ? eq(orders.accountId, query.accountId) : undefined,
          query.userId ? eq(orders.userId, query.userId) : undefined,
          query.from ? sql`${orders.placedAt} >= ${dayStart(query.from)}` : undefined,
          query.to ? sql`${orders.placedAt} < ${dayStart(query.to)} + interval '1 day'` : undefined,
          after,
        ),
      )
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const counts = new Map(
      page.length === 0
        ? []
        : (
            await tx
              .select({ orderId: orderLines.orderId, count: count() })
              .from(orderLines)
              .where(
                and(
                  eq(orderLines.tenantId, tenantId),
                  inArray(
                    orderLines.orderId,
                    page.map((row) => row.id),
                  ),
                ),
              )
              .groupBy(orderLines.orderId)
          ).map((row) => [row.orderId, row.count]),
    );
    const refs = await this.accounts.refs(
      tx,
      tenantId,
      page.map((row) => row.accountId),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      page.map((row) => row.userId),
    );
    return {
      items: page.map((row) => ({
        id: row.id,
        account: refs.get(row.accountId)!,
        placedBy: {
          id: row.userId,
          code: people.get(row.userId)?.code ?? '',
          name: people.get(row.userId)?.name ?? '',
        },
        placedAt: row.placedAt.toISOString(),
        status: row.status,
        lineCount: counts.get(row.id) ?? 0,
        total: row.total,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async get(tx: TenantTx, access: Access, id: string): Promise<OrderResult> {
    return this.result(tx, access, await this.row(tx, access, id));
  }

  private async result(tx: TenantTx, access: Access, row: OrderRow): Promise<OrderResult> {
    const { tenantId } = access;
    const lines = await tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, row.id)))
      .orderBy(asc(orderLines.position));
    const refs = await this.accounts.refs(tx, tenantId, [
      row.accountId,
      ...(row.supplierAccountId ? [row.supplierAccountId] : []),
    ]);
    const person = (await this.people.facts(tx, tenantId, [row.userId])).get(row.userId);
    const approval = row.workflowInstanceId
      ? await this.approvals.forOwner(tx, tenantId, row.workflowInstanceId)
      : null;
    const waiting = row.workflowInstanceId
      ? await this.approvals.waiting(tx, tenantId, row.workflowInstanceId)
      : null;
    const deciding =
      waiting !== null &&
      waiting.approverIds.includes(access.userId) &&
      row.userId !== access.userId;
    const measures: OrderResult['measures'] = {};
    for (const line of lines) {
      if (line.measureType && line.measureTotal) {
        const sum = scaled(measures[line.measureType] ?? '0', 3) + scaled(line.measureTotal, 3);
        measures[line.measureType] = unscaled(sum, 3);
      }
    }
    return {
      id: row.id,
      account: refs.get(row.accountId)!,
      supplier: {
        kind: row.supplierKind,
        account: row.supplierAccountId ? refs.get(row.supplierAccountId)! : null,
      },
      placedBy: { id: row.userId, code: person?.code ?? '', name: person?.name ?? '' },
      visitId: row.visitId,
      placedAt: row.placedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      note: row.note,
      photos: row.photoIds,
      status: row.status,
      rejectionReason: row.rejectionReason,
      lines: lines.map((line) => lineResult(line)),
      totals: {
        taxable: row.subtotal,
        tax: row.taxTotal,
        total: row.total,
        ...gstHalves(row.taxTotal),
      },
      measures,
      approval,
      can: {
        decide: deciding && access.permissions.has('order.decide'),
        decideLines:
          deciding && waiting.lineDecisions && access.permissions.has('order.line_decide'),
        fulfil:
          access.permissions.has('order.fulfil') && statusAfterFulfilment(row.status, []) !== null,
      },
      version: row.version,
    };
  }

  /** The tenant's reasons for rejecting orders and lines (spec 5.11). */
  async reasons(
    tx: TenantTx,
    tenantId: string,
  ): Promise<{ key: string; name: { en: string; hi: string } }[]> {
    const configured = (await this.catalogue.settings(tx, tenantId)).rejectionReasons;
    return configured.length > 0
      ? configured
      : DEFAULT_REJECTION_REASONS.map((reason) => ({ ...reason, name: { ...reason.name } }));
  }

  /** `POST /v1/orders/{id}/decision`: the whole order at the caller's step (BR-19). */
  async decide(
    tx: TenantTx,
    access: Access,
    id: string,
    body: OrderDecisionBody,
  ): Promise<OrderResult> {
    const { tenantId } = access;
    const row = await this.row(tx, access, id, true);
    if (!row.workflowInstanceId) throw new AppError('CONFLICT', 'This order is not waiting.');
    let note = body.note;
    if (body.decision === 'reject') {
      const reason = (await this.reasons(tx, tenantId)).find((entry) => entry.key === body.reason);
      if (!reason) throw invalid([issueAt(['reason'], 'Choose why it is rejected')]);
      note = [reason.name.en, body.note].filter(Boolean).join(': ');
      await tx
        .update(orders)
        .set({ rejectionReason: reason.key })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)));
    }
    await this.approvals.decide(
      tx,
      access,
      row.workflowInstanceId,
      {
        decision: body.decision === 'accept' ? 'approve' : 'reject',
        version: body.version,
        ...(note ? { note } : {}),
      },
      true,
    );
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'order.decided',
      target: { type: 'order', id },
      before: { status: row.status },
      after: { decision: body.decision, reason: body.reason ?? null },
    });
    return this.get(tx, access, id);
  }

  /**
   * `POST /v1/orders/{id}/line-decisions`: every line at a step that decides by line. Any line
   * accepted approves the step, which carries the lines\' decisions on; none rejects the order.
   */
  async decideLines(
    tx: TenantTx,
    access: Access,
    id: string,
    body: LineDecisionsBody,
  ): Promise<OrderResult> {
    const { tenantId } = access;
    const row = await this.row(tx, access, id, true);
    const waiting = row.workflowInstanceId
      ? await this.approvals.waiting(tx, tenantId, row.workflowInstanceId)
      : null;
    if (!waiting || !waiting.lineDecisions) {
      throw new AppError('CONFLICT', 'This step decides the whole order.');
    }
    const lines = await tx
      .select({ id: orderLines.id, decision: orderLines.decision })
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, id)));
    const reasons = new Set((await this.reasons(tx, tenantId)).map((reason) => reason.key));
    const decided = new Map(body.lines.map((line) => [line.lineId, line]));
    const issues: ErrorDetail[] = [];
    body.lines.forEach((line, index) => {
      if (!lines.some((entry) => entry.id === line.lineId)) {
        issues.push(issueAt(['lines', index, 'lineId'], 'This order has no such line'));
      } else if (line.decision === 'rejected' && !reasons.has(line.reason ?? '')) {
        issues.push(issueAt(['lines', index, 'reason'], 'Choose why it is rejected'));
      }
    });
    const open = lines.filter((line) => line.decision !== 'rejected');
    if (open.some((line) => !decided.has(line.id))) {
      issues.push(issueAt(['lines'], 'Decide every line'));
    }
    if (issues.length > 0) throw invalid(issues);
    for (const line of body.lines) {
      await tx
        .update(orderLines)
        .set({
          decision: line.decision,
          decisionReason: line.decision === 'rejected' ? line.reason! : null,
        })
        .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.id, line.lineId)));
    }
    const accepted = body.lines.some((line) => line.decision === 'accepted');
    await this.approvals.decide(
      tx,
      access,
      row.workflowInstanceId!,
      accepted
        ? { decision: 'approve', version: body.version, ...(body.note ? { note: body.note } : {}) }
        : {
            decision: 'reject',
            version: body.version,
            note: body.note ?? 'Every line was rejected',
          },
      true,
    );
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'order.lines_decided',
      target: { type: 'order', id },
      before: { status: row.status },
      after: { lines: body.lines },
    });
    return this.get(tx, access, id);
  }

  /** How the order's chain ended, applied in the deciding transaction (BR-19). */
  async decided(
    tx: TenantTx,
    tenantId: string,
    id: string,
    outcome: 'approved' | 'rejected' | 'cancelled',
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .for('update');
    if (!row || row.status !== 'submitted') return;
    let status: OrderStatus;
    if (outcome === 'approved') {
      const lines = await tx
        .select({ decision: orderLines.decision })
        .from(orderLines)
        .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, id)));
      status = statusFromLines(lines.map((line) => line.decision as LineDecision));
      await tx
        .update(orderLines)
        .set({ decision: 'accepted' })
        .where(
          and(
            eq(orderLines.tenantId, tenantId),
            eq(orderLines.orderId, id),
            eq(orderLines.decision, 'pending'),
          ),
        );
    } else {
      status = outcome === 'cancelled' ? 'cancelled' : 'rejected';
    }
    await this.setStatus(tx, tenantId, row, status);
  }

  private async setStatus(tx: TenantTx, tenantId: string, row: OrderRow, status: OrderStatus) {
    await tx
      .update(orders)
      .set({ status, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, row.id)));
    await this.outbox.publish(tx, tenantId, 'order.status_changed', row.id, {
      orderId: row.id,
      userId: row.userId,
      accountId: row.accountId,
      visitId: row.visitId,
      placedAt: row.placedAt.toISOString(),
      status,
    });
  }

  /**
   * `POST /v1/orders/{id}/fulfilment` (BR-19): base units fulfilled so far on accepted lines, or
   * cancelling an accepted order, at the order's version.
   */
  async fulfil(
    tx: TenantTx,
    access: Access,
    id: string,
    body: FulfilmentBody,
  ): Promise<OrderResult> {
    const { tenantId } = access;
    const row = await this.row(tx, access, id, true);
    if (row.version !== body.version) {
      throw new AppError('CONFLICT', 'This order changed meanwhile. Read it again.');
    }
    if (body.action === 'cancel') {
      if (row.status !== 'accepted' && row.status !== 'partially_accepted') {
        throw new AppError(
          'CONFLICT',
          'Only an accepted order that is not on its way can be cancelled.',
        );
      }
      await this.setStatus(tx, tenantId, row, 'cancelled');
      await this.audit.record(tx, tenantId, userActor(access), {
        action: 'order.cancelled',
        target: { type: 'order', id },
        before: { status: row.status },
        after: { status: 'cancelled', note: body.note },
      });
      return this.get(tx, access, id);
    }
    const lines = await tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, id)));
    const accepted = lines.filter((line) => line.decision === 'accepted');
    const given = new Map(body.lines.map((line) => [line.lineId, line.fulfilledUnits]));
    const issues: ErrorDetail[] = [];
    body.lines.forEach((entry, index) => {
      const line = accepted.find((one) => one.id === entry.lineId);
      if (!line)
        issues.push(issueAt(['lines', index, 'lineId'], 'Only accepted lines are fulfilled'));
      else if (scaled(entry.fulfilledUnits, 3) > scaled(line.baseUnits, 3)) {
        issues.push(issueAt(['lines', index, 'fulfilledUnits'], 'More than was ordered'));
      } else if (scaled(entry.fulfilledUnits, 3) < scaled(line.fulfilledUnits ?? '0', 3)) {
        issues.push(issueAt(['lines', index, 'fulfilledUnits'], 'Less than was already fulfilled'));
      }
    });
    if (issues.length > 0) throw invalid(issues);
    const next = statusAfterFulfilment(
      row.status,
      accepted.map((line) => ({
        ordered: line.baseUnits,
        fulfilled: given.get(line.id) ?? line.fulfilledUnits ?? '0',
      })),
    );
    if (next === null) {
      throw new AppError('CONFLICT', 'Only an accepted order can be fulfilled.');
    }
    for (const [lineId, units] of given) {
      await tx
        .update(orderLines)
        .set({ fulfilledUnits: units })
        .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.id, lineId)));
    }
    await this.setStatus(tx, tenantId, row, next);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'order.fulfilled',
      target: { type: 'order', id },
      before: { status: row.status },
      after: { status: next, lines: body.lines },
    });
    return this.get(tx, access, id);
  }

  /**
   * The orders a person placed on a day on the tenant's clock, with each line's decision, for
   * the metric engine (spec 12.5, decision D78). Values belong to the person who placed the order
   * and the day it was placed (BR-03).
   */
  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    date: string,
    timezone: string,
  ): Promise<DayOrder[]> {
    const rows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        visitId: orders.visitId,
        accountId: orders.accountId,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.userId, userId),
          onLocalDate(orders.placedAt, date, timezone),
        ),
      );
    if (rows.length === 0) return [];
    const lines = await tx
      .select()
      .from(orderLines)
      .where(
        and(
          eq(orderLines.tenantId, tenantId),
          inArray(
            orderLines.orderId,
            rows.map((row) => row.id),
          ),
        ),
      );
    const accounts = await this.accounts.forMetrics(
      tx,
      tenantId,
      rows.map((row) => row.accountId),
    );
    return rows.map((row) => ({
      status: row.status,
      visitId: row.visitId,
      account: accounts.get(row.accountId)!,
      lines: lines
        .filter((line) => line.orderId === row.id)
        .map((line) => ({
          decision: line.decision,
          taxable: line.taxable,
          total: line.total,
          baseUnits: line.baseUnits,
          measureType: line.measureType,
          measure: line.measureTotal,
        })),
    }));
  }

  /** What each order is about, for the approvals inbox. */
  async subjects(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ApprovalSubject>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: orders.id, accountId: orders.accountId, total: orders.total })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, [...ids])));
    const accounts = await this.accounts.subjects(
      tx,
      tenantId,
      rows.map((row) => row.accountId),
    );
    return new Map(
      rows.flatMap((row) => {
        const account = accounts.get(row.accountId);
        return account ? [[row.id, account]] : [];
      }),
    );
  }
}

function lineResult(line: LineRow): OrderResult['lines'][number] {
  const snapshot = line.snapshot as LineSnapshot;
  return {
    id: line.id,
    position: line.position,
    item: snapshot,
    unitKey: line.unitKey,
    quantity: line.quantity,
    factor: line.factor,
    baseUnits: line.baseUnits,
    measureType: line.measureType,
    measure: line.measureTotal,
    priceListId: line.priceListId,
    price: line.price,
    discount: line.discount,
    taxRate: line.taxRate,
    rate: line.rate,
    taxable: line.taxable,
    tax: line.tax,
    total: line.total,
    decision: line.decision,
    decisionReason: line.decisionReason,
    fulfilledUnits: line.fulfilledUnits,
  };
}
