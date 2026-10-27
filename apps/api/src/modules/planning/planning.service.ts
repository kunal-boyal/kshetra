import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  type ApprovalSubject,
  type CreatePlanItemBody,
  type CreateRouteBody,
  type GeneratePlanBody,
  type GeneratePlanResult,
  newId,
  nextPlanStatus,
  type PlanEvent,
  type PlanItemListQuery,
  type PlanItemListResult,
  type PlanItemResult,
  type PlanItemStatus,
  type RouteResult,
  routeDates,
  type SubmitPlanResult,
  todayIn,
  type UpdateRouteBody,
} from '@thelamp/shared';
import { and, asc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { accounts } from '../../db/schema/accounts';
import { planItems, planMonths, routeAccounts, routes } from '../../db/schema/planning';
import { type AuditActor, AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import { type Access, AccessResolver } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { CONFIG } from '../../platform/tokens';
import { AccountsService } from '../accounts/accounts.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApprovalsService } from '../workflow/approvals.service';

const invalid = (path: string, issue: string, message = 'Check the highlighted fields.') =>
  new AppError('VALIDATION', message, [{ path, issue }]);

const PLAN_ITEM = {
  id: planItems.id,
  userId: planItems.userId,
  accountId: accounts.id,
  accountCode: accounts.code,
  accountName: accounts.name,
  date: planItems.date,
  purpose: planItems.purpose,
  note: planItems.note,
  status: planItems.status,
  source: planItems.source,
  routeId: planItems.routeId,
  visitId: planItems.visitId,
};

/**
 * Journey plans (M8): each person's routes, the plan items made from them for a month or added
 * by hand, and how each item moves as it is visited and reviewed (BR-35). Where the tenant asks
 * for it, a person's month is approved through the `journey_plan` workflow before it counts.
 */
@Injectable()
export class PlanningService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly accounts: AccountsService,
    private readonly settings: TenantConfigService,
    private readonly approvals: ApprovalsService,
    private readonly resolver: AccessResolver,
  ) {}

  /** The person planned for, in the caller's scope (managers) or the caller themselves. */
  private async planned(tx: TenantTx, access: Access, userId: string): Promise<void> {
    if (userId !== access.userId && !(await this.scopes.reaches(tx, access, userId))) {
      throw outOfScope();
    }
  }

  /**
   * Which of these accounts the planned person sees (M8: a plan item references only an account
   * in the person's scope), by the person's own access, not the planner's.
   */
  private async seenBy(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const theirs = await this.resolver.onBehalfOf(tenantId, userId, this.config.CELL_ID);
    return new Set((await this.accounts.typesSeen(tx, theirs, ids)).keys());
  }

  // Routes.

  private async routeResults(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await tx
      .select()
      .from(routes)
      .where(and(eq(routes.tenantId, tenantId), inArray(routes.id, [...ids])))
      .orderBy(asc(routes.name), asc(routes.id));
    const stops = await tx
      .select({
        routeId: routeAccounts.routeId,
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
      })
      .from(routeAccounts)
      .innerJoin(
        accounts,
        and(
          eq(accounts.tenantId, routeAccounts.tenantId),
          eq(accounts.id, routeAccounts.accountId),
        ),
      )
      .where(and(eq(routeAccounts.tenantId, tenantId), inArray(routeAccounts.routeId, [...ids])))
      .orderBy(asc(routeAccounts.seq));
    return rows.map((row): RouteResult => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      recurrence: row.recurrence,
      active: row.active,
      accounts: stops
        .filter((stop) => stop.routeId === row.id)
        .map(({ id, code, name }) => ({ id, code, name })),
    }));
  }

  async routes(tx: TenantTx, access: Access, userId: string): Promise<RouteResult[]> {
    await this.planned(tx, access, userId);
    const ids = await tx
      .select({ id: routes.id })
      .from(routes)
      .where(and(eq(routes.tenantId, access.tenantId), eq(routes.userId, userId)));
    return this.routeResults(
      tx,
      access.tenantId,
      ids.map((row) => row.id),
    );
  }

  private async checkStops(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    accountIds: readonly string[],
  ): Promise<void> {
    if (new Set(accountIds).size !== accountIds.length) {
      throw invalid('accountIds', 'Each place can be on a route once');
    }
    const seen = await this.seenBy(tx, tenantId, userId, accountIds);
    const index = accountIds.findIndex((id) => !seen.has(id));
    if (index >= 0) {
      throw invalid(`accountIds[${index}]`, 'Choose a place this person looks after');
    }
  }

  private async writeStops(
    tx: TenantTx,
    tenantId: string,
    routeId: string,
    accountIds: readonly string[],
  ): Promise<void> {
    await tx
      .delete(routeAccounts)
      .where(and(eq(routeAccounts.tenantId, tenantId), eq(routeAccounts.routeId, routeId)));
    await tx
      .insert(routeAccounts)
      .values(accountIds.map((accountId, seq) => ({ tenantId, routeId, accountId, seq })));
  }

  async createRoute(tx: TenantTx, access: Access, body: CreateRouteBody): Promise<RouteResult> {
    const tenantId = access.tenantId;
    await this.planned(tx, access, body.userId);
    await this.checkStops(tx, tenantId, body.userId, body.accountIds);
    await tx.insert(routes).values({
      id: body.id,
      tenantId,
      userId: body.userId,
      name: body.name,
      recurrence: body.recurrence,
      createdBy: access.userId,
      updatedBy: access.userId,
    });
    await this.writeStops(tx, tenantId, body.id, body.accountIds);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'route.created',
      target: { type: 'route', id: body.id },
      before: null,
      after: body,
    });
    return (await this.routeResults(tx, tenantId, [body.id]))[0]!;
  }

  async updateRoute(
    tx: TenantTx,
    access: Access,
    id: string,
    body: UpdateRouteBody,
  ): Promise<RouteResult> {
    const tenantId = access.tenantId;
    const [row] = await tx
      .select()
      .from(routes)
      .where(and(eq(routes.tenantId, tenantId), eq(routes.id, id)))
      .for('update');
    if (!row) throw notFound();
    await this.planned(tx, access, row.userId);
    const before = (await this.routeResults(tx, tenantId, [id]))[0]!;
    if (body.accountIds) await this.checkStops(tx, tenantId, row.userId, body.accountIds);
    await tx
      .update(routes)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.recurrence !== undefined ? { recurrence: body.recurrence } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(routes.tenantId, tenantId), eq(routes.id, id)));
    if (body.accountIds) await this.writeStops(tx, tenantId, id, body.accountIds);
    const after = (await this.routeResults(tx, tenantId, [id]))[0]!;
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'route.updated',
      target: { type: 'route', id },
      before,
      after,
    });
    return after;
  }

  // Plans.

  /** The month's approval, when the tenant has plans approved; null otherwise. */
  private async month(tx: TenantTx, tenantId: string, userId: string, period: string) {
    const { journeyPlanApproval } = await this.settings.settings(tx, tenantId);
    if (!journeyPlanApproval) return null;
    const [row] = await tx
      .select()
      .from(planMonths)
      .where(
        and(
          eq(planMonths.tenantId, tenantId),
          eq(planMonths.userId, userId),
          eq(planMonths.period, period),
        ),
      );
    return { status: row?.status ?? 'draft', approvalId: row?.approvalId ?? null };
  }

  /**
   * Planning into a month that waits for approval, or was approved, is refused: an approved plan
   * is what was agreed. Only the person's own visits added by hand still go in (decision D53).
   */
  private async open(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    period: string,
  ): Promise<void> {
    const month = await this.month(tx, tenantId, userId, period);
    if (month && (month.status === 'submitted' || month.status === 'approved')) {
      throw new AppError(
        'CONFLICT',
        month.status === 'submitted'
          ? 'This month’s plan is waiting for approval.'
          : 'This month’s plan was approved and can’t change.',
      );
    }
  }

  /**
   * Makes a person's plan items for a month from their active routes (M8): one for each account
   * on each date a route falls on, from today on. Running it again makes nothing twice; accounts
   * the person no longer sees are left out.
   */
  async generate(
    tx: TenantTx,
    access: Access,
    body: GeneratePlanBody,
  ): Promise<GeneratePlanResult> {
    const tenantId = access.tenantId;
    await this.planned(tx, access, body.userId);
    await this.open(tx, tenantId, body.userId, body.period);
    const today = todayIn((await this.settings.settings(tx, tenantId)).timezone);
    const active = await tx
      .select()
      .from(routes)
      .where(
        and(eq(routes.tenantId, tenantId), eq(routes.userId, body.userId), eq(routes.active, true)),
      );
    const stops = active.length
      ? await tx
          .select()
          .from(routeAccounts)
          .where(
            and(
              eq(routeAccounts.tenantId, tenantId),
              inArray(
                routeAccounts.routeId,
                active.map((route) => route.id),
              ),
            ),
          )
          .orderBy(asc(routeAccounts.seq))
      : [];
    const seen = await this.seenBy(
      tx,
      tenantId,
      body.userId,
      stops.map((stop) => stop.accountId),
    );
    const skipped = new Set<string>();
    const values = [];
    for (const route of active) {
      const dates = routeDates(route.recurrence, body.period).filter((date) => date >= today);
      for (const stop of stops.filter((entry) => entry.routeId === route.id)) {
        if (!seen.has(stop.accountId)) {
          skipped.add(stop.accountId);
          continue;
        }
        for (const date of dates) {
          values.push({
            id: newId(),
            tenantId,
            userId: body.userId,
            accountId: stop.accountId,
            date,
            source: 'route' as const,
            routeId: route.id,
            createdBy: access.userId,
          });
        }
      }
    }
    const created = values.length
      ? (
          await tx
            .insert(planItems)
            .values(values)
            .onConflictDoNothing()
            .returning({ id: planItems.id })
        ).length
      : 0;
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'plan.generated',
      target: { type: 'user', id: body.userId },
      before: null,
      after: { period: body.period, created, skippedAccounts: [...skipped] },
    });
    return { created, skippedAccounts: [...skipped] };
  }

  private async items(tx: TenantTx, tenantId: string, where: ReturnType<typeof and>) {
    const rows = await tx
      .select(PLAN_ITEM)
      .from(planItems)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, planItems.tenantId), eq(accounts.id, planItems.accountId)),
      )
      .where(and(eq(planItems.tenantId, tenantId), where))
      .orderBy(asc(planItems.date), asc(planItems.createdAt), asc(planItems.id));
    return rows.map(({ accountId, accountCode, accountName, ...row }): PlanItemResult => ({
      ...row,
      account: { id: accountId, code: accountCode, name: accountName },
    }));
  }

  /** A person's plan for a month, by date, and the month's approval where there is one. */
  async list(tx: TenantTx, access: Access, query: PlanItemListQuery): Promise<PlanItemListResult> {
    await this.planned(tx, access, query.userId);
    return {
      items: await this.items(
        tx,
        access.tenantId,
        and(
          eq(planItems.userId, query.userId),
          sql`to_char(${planItems.date}, 'YYYY-MM') = ${query.period}`,
        ),
      ),
      approval: await this.month(tx, access.tenantId, query.userId, query.period),
    };
  }

  /**
   * Plans a visit by hand (M8): a manager for someone in their scope (`plan_item.manage`), or a
   * person for themselves; for today or later, at an account the person sees.
   */
  async create(tx: TenantTx, access: Access, body: CreatePlanItemBody): Promise<PlanItemResult> {
    const tenantId = access.tenantId;
    const own = body.userId === access.userId;
    if (!own && !access.permissions.has('plan_item.manage')) {
      throw new AppError('FORBIDDEN', 'Only managers plan visits for others.');
    }
    await this.planned(tx, access, body.userId);
    const today = todayIn((await this.settings.settings(tx, tenantId)).timezone);
    if (body.date < today) throw invalid('date', 'Choose today or a later day');
    // The person's own visits go in even after their month was approved.
    if (!own) await this.open(tx, tenantId, body.userId, body.date.slice(0, 7));
    if (!(await this.seenBy(tx, tenantId, body.userId, [body.accountId])).has(body.accountId)) {
      throw invalid('accountId', 'Choose a place this person looks after');
    }
    await tx.insert(planItems).values({
      id: body.id,
      tenantId,
      userId: body.userId,
      accountId: body.accountId,
      date: body.date,
      purpose: body.purpose || null,
      note: body.note || null,
      source: 'adhoc',
      createdBy: access.userId,
    });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'plan_item.created',
      target: { type: 'plan_item', id: body.id },
      before: null,
      after: body,
    });
    return (await this.items(tx, tenantId, eq(planItems.id, body.id)))[0]!;
  }

  /** A manager cancels a planned item (BR-35); anything else stays as it is. */
  async cancel(tx: TenantTx, access: Access, id: string): Promise<PlanItemResult> {
    const tenantId = access.tenantId;
    const [row] = await tx
      .select()
      .from(planItems)
      .where(and(eq(planItems.tenantId, tenantId), eq(planItems.id, id)))
      .for('update');
    if (!row) throw notFound();
    await this.planned(tx, access, row.userId);
    if (row.userId === access.userId && !access.permissions.has('plan_item.manage')) {
      throw new AppError('FORBIDDEN', 'Your manager cancels planned visits.');
    }
    if (row.status !== 'planned') {
      throw new AppError('CONFLICT', 'Only a planned visit can be cancelled.');
    }
    await this.move(tx, tenantId, userActor(access), row, 'cancelled', 'plan_item.cancelled');
    return (await this.items(tx, tenantId, eq(planItems.id, id)))[0]!;
  }

  /** Records a status change, audited and published. */
  private async move(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    row: Pick<typeof planItems.$inferSelect, 'id' | 'userId' | 'accountId' | 'date' | 'status'>,
    status: PlanItemStatus,
    action: 'plan_item.cancelled' | 'plan_item.status_changed' = 'plan_item.status_changed',
    visitId?: string,
  ): Promise<void> {
    await tx
      .update(planItems)
      .set({ status, updatedAt: new Date(), ...(visitId ? { visitId } : {}) })
      .where(and(eq(planItems.tenantId, tenantId), eq(planItems.id, row.id)));
    await this.audit.record(tx, tenantId, actor, {
      action,
      target: { type: 'plan_item', id: row.id },
      before: { status: row.status },
      after: { status, ...(visitId ? { visitId } : {}) },
    });
    if (status !== row.status) {
      await this.outbox.publish(tx, tenantId, 'plan_item.status_changed', row.id, {
        planItemId: row.id,
        userId: row.userId,
        accountId: row.accountId,
        date: row.date,
        before: row.status,
        status,
      });
    }
  }

  // BR-35: what visits and reviews do to plan items.

  /**
   * A visit started from a plan item (BR-34, BR-35): the item must be the person's own, for the
   * same account, and planned or visited already; it moves to visited and remembers the visit.
   */
  async startVisit(
    tx: TenantTx,
    access: Access,
    planItemId: string,
    accountId: string,
    visitId: string,
  ): Promise<void> {
    const tenantId = access.tenantId;
    const [row] = await tx
      .select()
      .from(planItems)
      .where(and(eq(planItems.tenantId, tenantId), eq(planItems.id, planItemId)))
      .for('update');
    if (!row) throw notFound();
    if (row.userId !== access.userId) throw outOfScope();
    if (row.accountId !== accountId) {
      throw invalid('planItemId', 'This planned visit is to another place');
    }
    const status = nextPlanStatus(row.status, { kind: 'visit_started' });
    if (!status) throw invalid('planItemId', 'This planned visit is no longer open');
    await this.move(
      tx,
      tenantId,
      userActor(access),
      row,
      status,
      'plan_item.status_changed',
      visitId,
    );
  }

  /**
   * A submission made in a visit was approved or rejected (BR-35): the plan item the visit
   * started from completes, or goes back to planned, or to missed once its day has ended.
   * Delivery is at least once; an event that changes nothing does nothing.
   */
  async reviewed(
    tx: TenantTx,
    tenantId: string,
    visitId: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const rows = await tx
      .select()
      .from(planItems)
      .where(and(eq(planItems.tenantId, tenantId), eq(planItems.visitId, visitId)))
      .for('update');
    if (rows.length === 0) return;
    const today = todayIn((await this.settings.settings(tx, tenantId)).timezone);
    for (const row of rows) {
      const event: PlanEvent =
        outcome === 'approved'
          ? { kind: 'submission_approved' }
          : { kind: 'submission_rejected', dayEnded: row.date < today };
      const status = nextPlanStatus(row.status, event);
      if (status) await this.move(tx, tenantId, SYSTEM_ACTOR, row, status);
    }
  }

  /** One person's plan items for a day, for plan compliance (spec 5.7). */
  /**
   * Visit compliance (M18): the plan items of people among `people` for the days from `from` to
   * `to`, by day and person, a page at a time.
   */
  async complianceRows(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ) {
    return tx
      .select({
        id: planItems.id,
        userId: planItems.userId,
        accountId: planItems.accountId,
        date: planItems.date,
        purpose: planItems.purpose,
        status: planItems.status,
        source: planItems.source,
      })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          sql`${planItems.userId} in (${people})`,
          sql`${planItems.date} between ${from} and ${to}`,
        ),
      )
      .orderBy(asc(planItems.date), asc(planItems.userId), asc(planItems.id))
      .offset(offset)
      .limit(limit + 1);
  }

  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    date: string,
  ): Promise<{ status: PlanItemStatus }[]> {
    return tx
      .select({ status: planItems.status })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          eq(planItems.userId, userId),
          eq(planItems.date, date),
        ),
      );
  }

  /** The accounts in each of these people's plans for a date, but cancelled items (M17). */
  async todayFor(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    date: string,
  ): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    if (userIds.length === 0) return found;
    const rows = await tx
      .select({ userId: planItems.userId, accountId: planItems.accountId })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          inArray(planItems.userId, [...new Set(userIds)]),
          eq(planItems.date, date),
          sql`${planItems.status} <> 'cancelled'`,
        ),
      );
    for (const row of rows)
      found.set(row.userId, [...(found.get(row.userId) ?? []), row.accountId]);
    return found;
  }

  /** Who has plan items on a date, and how many, for the morning notification (M16). */
  async dueOn(
    tx: TenantTx,
    tenantId: string,
    date: string,
  ): Promise<{ userId: string; count: number }[]> {
    return tx
      .select({ userId: planItems.userId, count: sql<number>`count(*)::int` })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          eq(planItems.date, date),
          sql`${planItems.status} <> 'cancelled'`,
        ),
      )
      .groupBy(planItems.userId);
  }

  /** Planned items whose day has ended are missed (BR-35). Returns how many. */
  async missDayEnded(tx: TenantTx, tenantId: string, today: string): Promise<number> {
    const due = await tx
      .select()
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          eq(planItems.status, 'planned'),
          lt(planItems.date, today),
        ),
      )
      .for('update', { skipLocked: true });
    for (const row of due) await this.move(tx, tenantId, SYSTEM_ACTOR, row, 'missed');
    return due.length;
  }

  // The month's approval (M8, the `journey_plan` workflow).

  /**
   * Sends a person's month for their manager's approval. The tenant must ask for plans to be
   * approved, and the month must hold something and not wait already or be approved.
   */
  async submit(
    tx: TenantTx,
    access: Access,
    userId: string,
    period: string,
  ): Promise<SubmitPlanResult> {
    const tenantId = access.tenantId;
    if (userId !== access.userId && !access.permissions.has('plan_item.manage')) {
      throw new AppError('FORBIDDEN', 'Only managers submit plans for others.');
    }
    await this.planned(tx, access, userId);
    const month = await this.month(tx, tenantId, userId, period);
    if (!month) {
      throw new AppError('CONFLICT', 'Plans don’t need approval here. Ask an admin to turn it on.');
    }
    await this.open(tx, tenantId, userId, period);
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, tenantId),
          eq(planItems.userId, userId),
          sql`to_char(${planItems.date}, 'YYYY-MM') = ${period}`,
          sql`${planItems.status} <> 'cancelled'`,
        ),
      );
    if (!held?.count) throw invalid('period', 'Plan some visits in this month first');
    const requestId = newId();
    // The person whose plan it is asks; their manager approves (BR-31).
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      userId,
      'journey_plan',
      requestId,
      userActor(access),
    );
    await tx
      .insert(planMonths)
      .values({ tenantId, userId, period, status: 'submitted', requestId, approvalId })
      .onConflictDoUpdate({
        target: [planMonths.tenantId, planMonths.userId, planMonths.period],
        set: { status: 'submitted', requestId, approvalId, updatedAt: new Date() },
      });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'plan.submitted',
      target: { type: 'user', id: userId },
      before: { period, status: month.status },
      after: { period, status: 'submitted', approvalId },
    });
    return { status: 'submitted', approvalId };
  }

  /** What each month waiting for approval is about, for the approvals inbox. */
  async subjects(
    tx: TenantTx,
    tenantId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, ApprovalSubject>> {
    if (requestIds.length === 0) return new Map();
    const rows = await tx
      .select({
        requestId: planMonths.requestId,
        userId: planMonths.userId,
        period: planMonths.period,
      })
      .from(planMonths)
      .where(
        and(eq(planMonths.tenantId, tenantId), inArray(planMonths.requestId, [...requestIds])),
      );
    const names = await this.people.facts(
      tx,
      tenantId,
      rows.map((row) => row.userId),
    );
    return new Map(
      rows.map((row) => [
        row.requestId!,
        { title: `${names.get(row.userId)?.name ?? ''} · ${row.period}`, accountId: null },
      ]),
    );
  }

  /** The manager's decision on a month: approved, or back to draft to plan again. */
  async decided(
    tx: TenantTx,
    by: Access,
    requestId: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const [row] = await tx
      .update(planMonths)
      .set({ status: outcome, updatedAt: new Date() })
      .where(and(eq(planMonths.tenantId, by.tenantId), eq(planMonths.requestId, requestId)))
      .returning();
    if (!row) return;
    await this.audit.record(tx, by.tenantId, userActor(by), {
      action: 'plan.decided',
      target: { type: 'user', id: row.userId },
      before: { period: row.period, status: 'submitted' },
      after: { period: row.period, status: outcome },
    });
  }
}
