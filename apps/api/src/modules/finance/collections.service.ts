import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CollectionDecisionsBody,
  type CollectionDecisionsResult,
  type CollectionIssue,
  type CollectionListQuery,
  type CollectionListResult,
  type CollectionMoveIssue,
  type CollectionResult,
  type CollectionStatusKey,
  collectedNotInBooks,
  collectionIssues,
  collectionMoveIssue,
  collectionNumber,
  type ErrorDetail,
  geofenceResult,
  issueAt,
  matchReceipts,
  type RecordCollectionBody,
  scaled,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { accountReceipts, collectionCounters, collections } from '../../db/schema/finance';
import { type AuditActor, AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { pointSql } from '../../platform/geo';
import { Outbox } from '../../platform/outbox';
import { AccountsService } from '../accounts/accounts.service';
import { ShiftsService } from '../field/shifts.service';
import { VisitsService } from '../field/visits.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type Row = typeof collections.$inferSelect;

/** Photos of a collection are owned by it (media kind `collection`). */
const OWNER = 'collection';

/** What each problem BR-63 finds says to the person. */
const ISSUE_WORDS: Record<CollectionIssue['issue'], string> = {
  amount: 'Enter an amount above zero',
  future: 'This is later than today. Check the phone’s clock',
  reference_needed: 'Enter the payment’s reference',
  cheque_number_needed: 'Enter the cheque number',
  cheque_bank_needed: 'Enter the cheque’s bank',
  cheque_date_needed: 'Enter the date on the cheque',
  cheque_photo_needed: 'Take a photo of the cheque',
  over_cash_limit: 'Cash from one account in a day must stay under the limit',
};

const MOVE_ERRORS: Record<CollectionMoveIssue, AppError> = {
  not_now: new AppError('CONFLICT', 'This collection has already been decided.'),
  not_cheque: new AppError('VALIDATION', 'Only a cheque can bounce.'),
  own: new AppError('FORBIDDEN', 'Someone else confirms your own collections.'),
  reason_needed: new AppError('VALIDATION', 'Check the highlighted fields.', [
    { path: 'reason', issue: 'Say why, in at least 3 characters' },
  ]),
};

const refuse = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/**
 * Collections (M11, BR-63, decision D132): recorded on the phone, decided by the office, and
 * matched to the books' receipts, by the rule whenever receipts are written or a collection is
 * confirmed, or by hand. They stand beside the books and never become receipts (spec 2.2).
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly accounts: AccountsService,
    private readonly shifts: ShiftsService,
    private readonly visits: VisitsService,
    private readonly photos: PhotosService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  /** `POST /v1/collections`: money taken from an account, with its ID from the phone. */
  async record(
    tx: TenantTx,
    access: Access,
    body: RecordCollectionBody,
  ): Promise<CollectionResult> {
    const { tenantId } = access;
    const settings = await this.config.settings(tx, tenantId);
    const collectedAt = Date.parse(body.collectedAt);
    if (collectedAt > Date.now() + 5 * 60_000) {
      throw refuse([issueAt(['collectedAt'], 'This is later than now. Check the phone’s clock')]);
    }
    // Taken in the field, a phone sends where; the office may record one without.
    if (access.deviceId && !body.fix) {
      throw refuse([issueAt(['fix'], 'Wait for a location fix')]);
    }
    const account = await this.accounts.find(tx, access, body.accountId);
    const visit = body.visitId ? await this.visits.own(tx, access, body.visitId) : null;
    if (visit && visit.accountId !== account.id) {
      throw refuse([issueAt(['visitId'], 'This visit was at another account')]);
    }
    const collectedOn = todayIn(settings.timezone, new Date(collectedAt));

    // The cheque's photos: the collector's own, of kind `collection`, used by no other record.
    if (new Set(body.photos).size !== body.photos.length) {
      throw refuse([issueAt(['photos'], 'Each photo can be used once')]);
    }
    for (const id of body.photos) await this.photos.attachable(tx, access, id, 'collection');
    const taken = (await this.photos.forRecord(tx, tenantId, body.photos)).filter(
      (photo) => photo.ownerId !== null && photo.ownerId !== body.id,
    );
    if (taken.length > 0) {
      throw refuse(
        taken.map((photo) =>
          issueAt(
            ['photos', body.photos.indexOf(photo.id)],
            'This photo belongs to another record',
          ),
        ),
      );
    }

    // BR-63, with the account's cash that day: another collection's lock waits on this one's.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`collections:${tenantId}:${account.id}:${collectedOn}`}, 0))`,
    );
    const issues = collectionIssues({
      amount: body.amount,
      mode: body.mode,
      collectedOn,
      today: todayIn(settings.timezone),
      reference: body.reference,
      chequeNumber: body.chequeNumber,
      chequeBank: body.chequeBank,
      chequeDate: body.chequeDate,
      photos: body.photos.length,
      cashThatDay: await this.cashOn(tx, tenantId, account.id, collectedOn),
      cashLimit: settings.collectionCashLimit,
    });
    if (issues.length > 0) {
      throw refuse(
        issues.map((issue) =>
          issueAt(
            [issue.path],
            issue.issue === 'over_cash_limit' && settings.collectionCashLimit !== null
              ? `Cash from one account in a day must stay under ₹${settings.collectionCashLimit}`
              : ISSUE_WORDS[issue.issue],
          ),
        ),
      );
    }

    // Where it was taken: inside the account's geofence or not, a flag and never a refusal.
    let inGeofence: boolean | null = null;
    if (body.fix) {
      const place = await this.accounts.forCapture(tx, access, account.id, body.fix.location);
      const result = geofenceResult({
        distanceM: place.distanceM,
        radiusM: place.radiusM,
        accuracyM: body.fix.accuracy,
        accuracyCapM: place.accuracyCapM,
      });
      inGeofence = result === 'unknown' ? null : result === 'inside';
    }
    const shift = await this.shifts.at(tx, tenantId, access.userId, collectedAt);
    const number = await this.nextNumber(tx, tenantId);
    await tx.insert(collections).values({
      tenantId,
      id: body.id,
      number,
      accountId: account.id,
      userId: access.userId,
      deviceId: access.deviceId ?? null,
      visitId: visit?.id ?? null,
      shiftId: shift?.id ?? null,
      collectedOn,
      collectedAt: new Date(collectedAt),
      amount: body.amount,
      mode: body.mode,
      reference: body.mode === 'upi' || body.mode === 'bank_transfer' ? body.reference : null,
      chequeNumber: body.mode === 'cheque' ? body.chequeNumber : null,
      chequeBank: body.mode === 'cheque' ? body.chequeBank : null,
      chequeDate: body.mode === 'cheque' ? body.chequeDate : null,
      note: body.note,
      point: body.fix ? pointSql(body.fix.location) : null,
      accuracy: body.fix?.accuracy ?? null,
      inGeofence,
    });
    await this.photos.attach(tx, tenantId, body.photos, { type: OWNER, id: body.id });
    const [row] = await this.rows(tx, tenantId, eq(collections.id, body.id));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'collection.recorded',
      target: { type: 'collection', id: body.id },
      before: null,
      after: {
        number: collectionNumber(number),
        accountId: account.id,
        amount: body.amount,
        mode: body.mode,
        collectedOn,
        inGeofence,
      },
    });
    await this.publish(tx, 'collection.recorded', row!);
    return this.one(tx, access, body.id);
  }

  /** `GET /v1/collections`: newest first, in the caller's reach, with the first page's summary. */
  async list(
    tx: TenantTx,
    access: Access,
    query: CollectionListQuery,
  ): Promise<CollectionListResult> {
    const { tenantId } = access;
    const filters = and(
      await this.visible(tx, access),
      query.accountId ? eq(collections.accountId, query.accountId) : undefined,
      query.userId ? eq(collections.userId, query.userId) : undefined,
      query.period
        ? sql`to_char(${collections.collectedOn}, 'YYYY-MM') = ${query.period}`
        : undefined,
    )!;
    let after: SQL | undefined;
    if (query.cursor) {
      const [at] = await tx
        .select({ collectedAt: collections.collectedAt })
        .from(collections)
        .where(and(eq(collections.tenantId, tenantId), eq(collections.id, query.cursor)));
      if (at) {
        after = or(
          lt(collections.collectedAt, at.collectedAt),
          and(eq(collections.collectedAt, at.collectedAt), lt(collections.id, query.cursor)),
        );
      }
    }
    const rows = await tx
      .select()
      .from(collections)
      .where(and(filters, query.status ? eq(collections.status, query.status) : undefined, after))
      .orderBy(desc(collections.collectedAt), desc(collections.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    let summary: CollectionListResult['summary'] = null;
    if (!query.cursor) {
      const totals = await tx
        .select({
          status: collections.status,
          count: sql<number>`count(*)::int`,
          amount: sql<string>`sum(${collections.amount})::text`,
        })
        .from(collections)
        .where(filters)
        .groupBy(collections.status);
      summary = {
        counts: Object.fromEntries(totals.map((total) => [total.status, total.count])),
        amounts: Object.fromEntries(
          totals.map((total) => [total.status, unscaled(scaled(total.amount, 2), 2)]),
        ),
      };
    }
    return {
      items: await this.results(tx, access, page),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
      summary,
    };
  }

  /** `GET /v1/collections/{id}`. */
  async get(tx: TenantTx, access: Access, id: string): Promise<CollectionResult> {
    await this.seen(tx, access, id);
    return this.one(tx, access, id);
  }

  /**
   * `POST /v1/collections/decisions`: confirms or rejects each, on its own (BR-63); one refused
   * leaves the others decided. A confirmed collection is matched at once if its receipt is in.
   */
  async decide(
    tx: TenantTx,
    access: Access,
    body: CollectionDecisionsBody,
  ): Promise<CollectionDecisionsResult> {
    const results: CollectionDecisionsResult['results'] = [];
    for (const item of body.items) {
      try {
        const collection = await this.database.savepoint(tx, async (inner) => {
          const row = await this.locked(inner, access, item.id);
          const to = item.decision === 'confirm' ? 'confirmed' : 'rejected';
          await this.move(inner, access, row, to, item.reason ?? null);
          if (to === 'confirmed') {
            await this.match(inner, access.tenantId, [row.accountId], userActor(access));
          }
          return this.one(inner, access, row.id);
        });
        results.push({ id: item.id, collection, error: null });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        results.push({
          id: item.id,
          collection: null,
          error: { code: error.code, message: error.message },
        });
      }
    }
    return { results };
  }

  /** `POST /v1/collections/{id}/bounce`: a confirmed cheque came back unpaid (BR-63). */
  async bounce(
    tx: TenantTx,
    access: Access,
    id: string,
    reason: string,
  ): Promise<CollectionResult> {
    const row = await this.locked(tx, access, id);
    await this.move(tx, access, row, 'bounced', reason);
    return this.one(tx, access, id);
  }

  /**
   * `POST /v1/collections/{id}/match`: the books' receipt for a confirmed collection, named by
   * hand: the account's own, not cancelled, and matched to no other collection.
   */
  async matchByHand(
    tx: TenantTx,
    access: Access,
    id: string,
    receiptId: string,
  ): Promise<CollectionResult> {
    const row = await this.locked(tx, access, id);
    this.allowed(access, row, 'in_books', null);
    const [receipt] = await tx
      .select({
        id: accountReceipts.id,
        accountId: accountReceipts.accountId,
        cancelled: accountReceipts.cancelled,
        number: accountReceipts.number,
      })
      .from(accountReceipts)
      .where(and(eq(accountReceipts.tenantId, access.tenantId), eq(accountReceipts.id, receiptId)));
    if (!receipt || receipt.accountId !== row.accountId || receipt.cancelled) {
      throw refuse([issueAt(['receiptId'], 'Choose a receipt of this account')]);
    }
    const [other] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.tenantId, access.tenantId), eq(collections.receiptId, receiptId)));
    if (other) {
      throw refuse([issueAt(['receiptId'], 'This receipt is matched to another collection')]);
    }
    await this.setMatched(tx, access.tenantId, row, receipt, true, userActor(access));
    return this.one(tx, access, id);
  }

  /** `POST /v1/collections/{id}/unmatch`: a match made by mistake; the collection waits again. */
  async unmatch(tx: TenantTx, access: Access, id: string): Promise<CollectionResult> {
    const row = await this.locked(tx, access, id);
    this.allowed(access, row, 'confirmed', null);
    await this.setUnmatched(tx, access.tenantId, row, userActor(access), 'by_hand');
    return this.one(tx, access, id);
  }

  /**
   * BR-63's matching for some accounts, after receipts are written or a collection confirmed:
   * matches the books' receipts change or cancel are undone (hand matches only when cancelled),
   * then each unmatched receipt takes the oldest confirmed collection of its amount.
   */
  async match(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
    actor: AuditActor,
  ): Promise<void> {
    if (accountIds.length === 0) return;
    const ids = [...new Set(accountIds)];
    const stale = await tx
      .select({ row: collections })
      .from(collections)
      .innerJoin(
        accountReceipts,
        and(
          eq(accountReceipts.tenantId, collections.tenantId),
          eq(accountReceipts.id, collections.receiptId),
        ),
      )
      .where(
        and(
          eq(collections.tenantId, tenantId),
          inArray(collections.accountId, ids),
          eq(collections.status, 'in_books'),
          or(
            eq(accountReceipts.cancelled, true),
            and(
              eq(collections.matchedByHand, false),
              sql`${accountReceipts.amount} <> ${collections.amount}`,
            ),
          ),
        ),
      )
      // The receipts too: they are being written in this transaction already.
      .for('update');
    for (const { row } of stale) await this.setUnmatched(tx, tenantId, row, actor, 'receipt');

    const waiting = await tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.tenantId, tenantId),
          inArray(collections.accountId, ids),
          eq(collections.status, 'confirmed'),
          isNull(collections.receiptId),
        ),
      )
      .for('update');
    if (waiting.length === 0) return;
    const earliest = waiting.reduce(
      (first, row) => (row.collectedOn < first ? row.collectedOn : first),
      waiting[0]!.collectedOn,
    );
    const receipts = await tx
      .select({
        id: accountReceipts.id,
        accountId: accountReceipts.accountId,
        amount: accountReceipts.amount,
        date: accountReceipts.date,
        number: accountReceipts.number,
      })
      .from(accountReceipts)
      .where(
        and(
          eq(accountReceipts.tenantId, tenantId),
          inArray(accountReceipts.accountId, ids),
          eq(accountReceipts.cancelled, false),
          eq(accountReceipts.kind, 'receipt'),
          sql`${accountReceipts.date} >= ${earliest}`,
          sql`not exists (select 1 from ${collections} c
                where c.tenant_id = ${accountReceipts.tenantId} and c.receipt_id = ${accountReceipts.id})`,
        ),
      );
    const byId = new Map(waiting.map((row) => [row.id, row]));
    const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
    for (const found of matchReceipts(
      waiting.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        amount: row.amount,
        collectedOn: row.collectedOn,
        recordedAt: row.createdAt.toISOString(),
      })),
      receipts,
    )) {
      await this.setMatched(
        tx,
        tenantId,
        byId.get(found.collectionId)!,
        receiptById.get(found.receiptId)!,
        false,
        actor,
      );
    }
  }

  /** What each account's collections not yet in the books add up to (BR-63), by account. */
  async notInBooks(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (accountIds.length === 0) return new Map();
    const rows = await tx
      .select({
        accountId: collections.accountId,
        amount: sql<string>`sum(${collections.amount})::text`,
      })
      .from(collections)
      .where(
        and(
          eq(collections.tenantId, tenantId),
          inArray(collections.accountId, [...new Set(accountIds)]),
          inArray(collections.status, ['recorded', 'confirmed']),
        ),
      )
      .groupBy(collections.accountId);
    return new Map(rows.map((row) => [row.accountId, unscaled(scaled(row.amount, 2), 2)]));
  }

  /** An account's outstanding after its collections not yet in the books (BR-63). */
  async afterCollections(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    outstanding: string,
  ): Promise<{ notInBooks: string; leftAfter: string }> {
    const pending = (await this.notInBooks(tx, tenantId, [accountId])).get(accountId) ?? '0.00';
    return collectedNotInBooks(outstanding, [{ amount: pending, status: 'recorded' }]);
  }

  /** The person's collections on a day, for the metric engine; rejected and bounced left out. */
  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    date: string,
  ): Promise<{ amount: string; mode: string; confirmed: boolean }[]> {
    const rows = await tx
      .select({ amount: collections.amount, mode: collections.mode, status: collections.status })
      .from(collections)
      .where(
        and(
          eq(collections.tenantId, tenantId),
          eq(collections.userId, userId),
          eq(collections.collectedOn, date),
          inArray(collections.status, ['recorded', 'confirmed', 'in_books']),
        ),
      );
    return rows.map((row) => ({
      amount: row.amount,
      mode: row.mode,
      confirmed: row.status !== 'recorded',
    }));
  }

  /**
   * The report's rows (M18): collections taken from `from` to `to` by the people `people` selects,
   * as the caller may see them, a page at a time by day and number.
   */
  async forReport(
    tx: TenantTx,
    access: Access,
    people: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: CollectionResult[]; more: boolean }> {
    const rows = await tx
      .select()
      .from(collections)
      .where(
        and(
          await this.visible(tx, access),
          sql`${collections.collectedOn} between ${from} and ${to}`,
          sql`${collections.userId} in (${people})`,
        ),
      )
      .orderBy(collections.collectedOn, collections.number)
      .offset(offset)
      .limit(limit + 1);
    return {
      rows: await this.results(tx, access, rows.slice(0, limit)),
      more: rows.length > limit,
    };
  }

  /**
   * What phones keep, in (row version, ID) order: the person's own collections since `since`,
   * and at the accounts in `reach` every one not yet in the books, with those whose status moved
   * since then, so a phone learns one went into the books or was turned down.
   */
  async forSync(
    tx: TenantTx,
    access: Access,
    reach: SQL,
    since: string,
    page: { since: number; after: readonly [number, string] | null; limit: number },
  ): Promise<Row[]> {
    return tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.tenantId, access.tenantId),
          or(
            and(
              sql`${collections.accountId}::text in ${reach}`,
              or(
                inArray(collections.status, ['recorded', 'confirmed']),
                sql`${collections.updatedAt} >= ${since}::date`,
              ),
            ),
            and(eq(collections.userId, access.userId), sql`${collections.collectedOn} >= ${since}`),
          ),
          sql`${collections.rowVersion} >= ${page.since}`,
          page.after
            ? sql`(${collections.rowVersion}, ${collections.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(collections.rowVersion, collections.id)
      .limit(page.limit);
  }

  /** What a notice about a collection names: its number, amount, account, reason and decider. */
  async notice(
    tx: TenantTx,
    tenantId: string,
    id: string,
  ): Promise<{
    number: string;
    amount: string;
    account: string;
    reason: string;
    decidedBy: string | null;
  } | null> {
    const [row] = await this.rows(tx, tenantId, eq(collections.id, id));
    if (!row) return null;
    const account = (await this.accounts.refs(tx, tenantId, [row.accountId])).get(row.accountId);
    const decider = row.decidedBy
      ? (await this.people.facts(tx, tenantId, [row.decidedBy])).get(row.decidedBy)
      : undefined;
    return {
      number: collectionNumber(row.number),
      amount: unscaled(scaled(row.amount, 2), 2),
      account: account?.name ?? '',
      reason: row.reason ?? '',
      decidedBy: decider?.name ?? null,
    };
  }

  /** Photos of these collections, by collection, for the phone's copy. */
  async photosOf(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    for (const photo of await this.photos.ownedBy(tx, tenantId, OWNER, ids)) {
      found.set(photo.ownerId, [...(found.get(photo.ownerId) ?? []), photo.id]);
    }
    return found;
  }

  private async move(
    tx: TenantTx,
    access: Access,
    row: Row,
    to: CollectionStatusKey,
    reason: string | null,
  ): Promise<void> {
    this.allowed(access, row, to, reason);
    const decider = access.apiClient || access.support ? null : access.userId;
    await tx
      .update(collections)
      .set({
        status: to,
        reason: to === 'confirmed' ? null : reason?.trim() || null,
        decidedBy: decider,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(collections.tenantId, access.tenantId), eq(collections.id, row.id)));
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action:
        to === 'confirmed'
          ? 'collection.confirmed'
          : to === 'rejected'
            ? 'collection.rejected'
            : 'collection.bounced',
      target: { type: 'collection', id: row.id },
      before: { status: row.status },
      after: { status: to, reason },
    });
    await this.publish(tx, 'collection.status_changed', { ...row, status: to });
  }

  private allowed(access: Access, row: Row, to: CollectionStatusKey, reason: string | null): void {
    if (!access.permissions.has('collection.confirm')) {
      throw new AppError('FORBIDDEN', 'You cannot decide collections.');
    }
    const issue = collectionMoveIssue({
      from: row.status,
      to,
      mode: row.mode,
      own: !access.apiClient && !access.support && row.userId === access.userId,
      reason,
    });
    if (issue) throw MOVE_ERRORS[issue];
  }

  private async setMatched(
    tx: TenantTx,
    tenantId: string,
    row: Row,
    receipt: { id: string; number: string },
    byHand: boolean,
    actor: AuditActor,
  ): Promise<void> {
    await tx
      .update(collections)
      .set({
        status: 'in_books',
        receiptId: receipt.id,
        matchedByHand: byHand,
        matchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(collections.tenantId, tenantId), eq(collections.id, row.id)));
    await this.audit.record(tx, tenantId, actor, {
      action: 'collection.matched',
      target: { type: 'collection', id: row.id },
      before: { status: row.status },
      after: { status: 'in_books', receipt: receipt.number, byHand },
    });
    await this.publish(tx, 'collection.status_changed', { ...row, status: 'in_books' });
  }

  private async setUnmatched(
    tx: TenantTx,
    tenantId: string,
    row: Row,
    actor: AuditActor,
    why: 'by_hand' | 'receipt',
  ): Promise<void> {
    await tx
      .update(collections)
      .set({
        status: 'confirmed',
        receiptId: null,
        matchedByHand: false,
        matchedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(collections.tenantId, tenantId), eq(collections.id, row.id)));
    await this.audit.record(tx, tenantId, actor, {
      action: 'collection.unmatched',
      target: { type: 'collection', id: row.id },
      before: { status: row.status, receiptId: row.receiptId },
      after: { status: 'confirmed', why },
    });
    await this.publish(tx, 'collection.status_changed', { ...row, status: 'confirmed' });
  }

  private async publish(
    tx: TenantTx,
    type: 'collection.recorded' | 'collection.status_changed',
    row: Row,
  ): Promise<void> {
    await this.outbox.publish(tx, row.tenantId, type, row.id, {
      collectionId: row.id,
      userId: row.userId,
      accountId: row.accountId,
      collectedOn: row.collectedOn,
      amount: row.amount,
      mode: row.mode,
      status: row.status,
    });
  }

  /** Cash recorded from an account on a day, rejected and bounced collections left out. */
  private async cashOn(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    day: string,
  ): Promise<string> {
    const [row] = await tx
      .select({ amount: sql<string | null>`sum(${collections.amount})::text` })
      .from(collections)
      .where(
        and(
          eq(collections.tenantId, tenantId),
          eq(collections.accountId, accountId),
          eq(collections.collectedOn, day),
          eq(collections.mode, 'cash'),
          inArray(collections.status, ['recorded', 'confirmed', 'in_books']),
        ),
      );
    return row?.amount ?? '0';
  }

  /** The tenant's next number, its counter locked by the upsert until the transaction ends. */
  private async nextNumber(tx: TenantTx, tenantId: string): Promise<number> {
    const [counter] = await tx
      .insert(collectionCounters)
      .values({ tenantId, last: 1 })
      .onConflictDoUpdate({
        target: collectionCounters.tenantId,
        set: { last: sql`${collectionCounters.last} + 1` },
      })
      .returning({ last: collectionCounters.last });
    return counter!.last;
  }

  /**
   * Who sees a collection: whoever took it; with `collection.view`, the people over them and
   * those who see its account.
   */
  private async visible(tx: TenantTx, access: Access): Promise<SQL> {
    const tenant = eq(collections.tenantId, access.tenantId);
    if (!access.permissions.has('collection.view')) {
      return and(tenant, eq(collections.userId, access.userId))!;
    }
    if (access.scope === 'tenant') return tenant;
    return and(
      tenant,
      or(
        eq(collections.userId, access.userId),
        sql`${collections.userId} in (${await this.scopes.userIds(tx, access)})`,
        sql`${collections.accountId}::text in ${await this.accounts.reachIds(tx, access)}`,
      ),
    )!;
  }

  /** Another tenant's collection is nowhere; one outside the caller's reach is out of scope. */
  private async seen(tx: TenantTx, access: Access, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.tenantId, access.tenantId), eq(collections.id, id)));
    if (!row) throw notFound();
    const [visible] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(await this.visible(tx, access), eq(collections.id, id)));
    if (!visible) throw outOfScope();
  }

  private async locked(tx: TenantTx, access: Access, id: string): Promise<Row> {
    await this.seen(tx, access, id);
    const [row] = await tx
      .select()
      .from(collections)
      .where(and(eq(collections.tenantId, access.tenantId), eq(collections.id, id)))
      .for('update');
    return row!;
  }

  private rows(tx: TenantTx, tenantId: string, where: SQL): Promise<Row[]> {
    return tx
      .select()
      .from(collections)
      .where(and(eq(collections.tenantId, tenantId), where));
  }

  private async one(tx: TenantTx, access: Access, id: string): Promise<CollectionResult> {
    const rows = await this.rows(tx, access.tenantId, eq(collections.id, id));
    if (rows.length === 0) throw notFound();
    const [result] = await this.results(tx, access, rows);
    return result!;
  }

  private async results(
    tx: TenantTx,
    access: Access,
    rows: readonly Row[],
  ): Promise<CollectionResult[]> {
    if (rows.length === 0) return [];
    const { tenantId } = access;
    const accounts = await this.accounts.refs(
      tx,
      tenantId,
      rows.map((row) => row.accountId),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.flatMap((row) => [row.userId, ...(row.decidedBy ? [row.decidedBy] : [])]),
    );
    const receiptIds = rows.flatMap((row) => (row.receiptId ? [row.receiptId] : []));
    const receipts = new Map(
      (receiptIds.length === 0
        ? []
        : await tx
            .select({
              id: accountReceipts.id,
              number: accountReceipts.number,
              date: accountReceipts.date,
            })
            .from(accountReceipts)
            .where(
              and(eq(accountReceipts.tenantId, tenantId), inArray(accountReceipts.id, receiptIds)),
            )
      ).map((receipt) => [receipt.id, receipt]),
    );
    const photos = await this.photosOf(
      tx,
      tenantId,
      rows.map((row) => row.id),
    );
    const who = (id: string) => {
      const person = people.get(id);
      return { id, code: person?.code ?? '', name: person?.name ?? '' };
    };
    const confirms = access.permissions.has('collection.confirm');
    return rows.map((row) => {
      const own = !access.apiClient && !access.support && row.userId === access.userId;
      const receipt = row.receiptId ? receipts.get(row.receiptId) : undefined;
      return {
        id: row.id,
        number: collectionNumber(row.number),
        account: accounts.get(row.accountId) ?? { id: row.accountId, code: '', name: '' },
        collector: who(row.userId),
        collectedOn: row.collectedOn,
        collectedAt: row.collectedAt.toISOString(),
        amount: unscaled(scaled(row.amount, 2), 2),
        mode: row.mode,
        reference: row.reference,
        chequeNumber: row.chequeNumber,
        chequeBank: row.chequeBank,
        chequeDate: row.chequeDate,
        note: row.note,
        photos: photos.get(row.id) ?? [],
        inGeofence: row.inGeofence,
        status: row.status,
        reason: row.reason,
        decidedBy: row.decidedBy ? who(row.decidedBy) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        receipt: receipt
          ? {
              id: receipt.id,
              number: receipt.number,
              date: receipt.date,
              byHand: row.matchedByHand,
            }
          : null,
        can: {
          decide: confirms && !own && row.status === 'recorded',
          bounce: confirms && !own && row.status === 'confirmed' && row.mode === 'cheque',
          match: confirms && row.status === 'confirmed',
          unmatch: confirms && row.status === 'in_books',
        },
      };
    });
  }
}
