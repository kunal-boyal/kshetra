import { Injectable } from '@nestjs/common';
import {
  accountSegments,
  checkSlots,
  checkValueChanges,
  primaryAssignee,
  type SlotHolder,
} from '@thelamp/forms';
import {
  type AccountListQuery,
  type AccountListResult,
  type AccountOverview,
  type AccountResult,
  AppError,
  type ContactResult,
  type CreateAccountBody,
  type CreateContactBody,
  type CreateLocationProposalBody,
  type ErrorDetail,
  type GeoPoint,
  geofenceRadius,
  issueAt,
  type LocationProposalResult,
  normalisePhone,
  proposalFix,
  type SlotChanges,
  type TenantSettings,
  todayIn,
  type UpdateAccountBody,
  type UpdateContactBody,
} from '@thelamp/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  accountLocationProposals,
  accounts,
  accountSlots,
  accountTypes,
  contacts,
} from '../../db/schema/accounts';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointOf, pointSql } from '../../platform/geo';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { ApprovalsService } from '../workflow/approvals.service';
import { AccountTypesService, type TypeRecord } from './account-types.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);
const invalidAt = (path: string, issue: string) => invalid([{ path, issue }]);

/** How far ahead of the server a phone's clock may run before its times are refused. */
const CLOCK_AHEAD_MS = 5 * 60_000;

const ROW = {
  id: accounts.id,
  tenantId: accounts.tenantId,
  typeId: accounts.typeId,
  code: accounts.code,
  name: accounts.name,
  territoryId: accounts.territoryId,
  parentAccountId: accounts.parentAccountId,
  address: accounts.address,
  location: pointOf(accounts.location),
  geofenceRadiusM: accounts.geofenceRadiusM,
  locationStatus: accounts.locationStatus,
  status: accounts.status,
  segments: accounts.segments,
  custom: accounts.custom,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
  createdBy: accounts.createdBy,
};

function selectRows(tx: TenantTx) {
  return tx.select(ROW).from(accounts);
}

/** An account as stored, with its location read back as a point. */
export type AccountRow = Awaited<ReturnType<typeof selectRows>>[number];

/** Slot rows that apply on `day`: `valid_to` is the first day one no longer applies. */
export function slotsOn(day: string): SQL {
  return and(
    lte(accountSlots.validFrom, day),
    or(isNull(accountSlots.validTo), gt(accountSlots.validTo, day)),
  )!;
}

/**
 * Accounts (spec 5.5, M4). Who sees an account follows today's slot holders, the territories of a
 * territory scope, and what the caller proposed; the rules themselves are pure functions in
 * `@thelamp/forms`.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly types: AccountTypesService,
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly approvals: ApprovalsService,
  ) {}

  async settings(tx: TenantTx, tenantId: string): Promise<TenantSettings> {
    return this.config.settings(tx, tenantId);
  }

  async today(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone);
  }

  /**
   * A condition on `accounts` that holds for the accounts the caller sees (spec 5.5): someone in
   * their scope fills one of its slots today, it sits in their territories when the scope covers
   * territory, or they proposed it.
   */
  async reach(tx: TenantTx, access: Access): Promise<SQL> {
    if (access.scope === 'tenant') return sql`true`;
    const today = await this.today(tx, access.tenantId);
    const holders = await this.scopes.userIds(tx, access);
    const bySlot = sql`exists (
      select 1 from ${accountSlots} s
       where s.tenant_id = ${accounts.tenantId} and s.account_id = ${accounts.id}
         and s.valid_from <= ${today}::date
         and (s.valid_to is null or s.valid_to > ${today}::date)
         and s.user_id in (${holders}))`;
    const byTerritory =
      access.scope === 'territory' || access.scope === 'team_or_territory'
        ? sql`${accounts.territoryId} in (${this.territories.territoriesReachedBy(
            access.tenantId,
            access.userId,
            today,
          )})`
        : undefined;
    return or(bySlot, byTerritory, eq(accounts.createdBy, access.userId))!;
  }

  async list(tx: TenantTx, access: Access, query: AccountListQuery): Promise<AccountListResult> {
    const tenantId = access.tenantId;
    const type = query.type ? await this.types.byKey(tx, tenantId, query.type) : undefined;
    if (query.type && !type) return { items: [], nextCursor: null };
    const today = await this.today(tx, tenantId);
    const search = query.q
      ? or(ilike(accounts.name, containing(query.q)), ilike(accounts.code, containing(query.q)))
      : undefined;
    const rows = await selectRows(tx)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          await this.reach(tx, access),
          type ? eq(accounts.typeId, type.id) : undefined,
          query.status ? eq(accounts.status, query.status) : undefined,
          query.segment ? sql`${query.segment} = any(${accounts.segments})` : undefined,
          query.territoryId
            ? sql`${accounts.territoryId} in (${this.territories.subtree(tenantId, query.territoryId)})`
            : undefined,
          query.userId
            ? sql`exists (select 1 from ${accountSlots} s
                where s.tenant_id = ${accounts.tenantId} and s.account_id = ${accounts.id}
                  and s.user_id = ${query.userId}
                  and s.valid_from <= ${today}::date
                  and (s.valid_to is null or s.valid_to > ${today}::date))`
            : undefined,
          search,
          query.cursor ? gt(accounts.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(accounts.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: await this.results(tx, tenantId, page),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  /** An account the caller sees: another tenant's is `NOT_FOUND`, one out of reach `OUT_OF_SCOPE`. */
  async find(tx: TenantTx, access: Access, id: string, lock = false): Promise<AccountRow> {
    const row = await this.row(tx, access.tenantId, id, lock);
    const [seen] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, access.tenantId),
          eq(accounts.id, id),
          await this.reach(tx, access),
        ),
      );
    if (!seen) throw outOfScope();
    return row;
  }

  /**
   * An account as a capture there needs it (M6, BR-33, BR-34): one the caller sees, its type and
   * status, and the geofence a fix at `point` is judged by: the distance from its verified
   * location (null without one), its radius, the type's policy and the tenant's accuracy credit.
   */
  async forCapture(tx: TenantTx, access: Access, id: string, point: GeoPoint) {
    const row = await this.find(tx, access, id);
    const type = (await this.types.list(tx, access.tenantId)).find(
      (entry) => entry.id === row.typeId,
    )!;
    const settings = await this.settings(tx, access.tenantId);
    const [measured] = await tx
      .select({
        distanceM: sql<number | null>`case when ${accounts.locationStatus} = 'verified'
          and ${accounts.location} is not null
          then ST_Distance(${accounts.location}, ${pointSql(point)}) end`,
      })
      .from(accounts)
      .where(and(eq(accounts.tenantId, access.tenantId), eq(accounts.id, id)));
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: type.key,
      status: row.status,
      contacts: type.definition.contacts,
      distanceM:
        measured?.distanceM === null || measured?.distanceM === undefined
          ? null
          : Number(measured.distanceM),
      radiusM: geofenceRadius(
        row.geofenceRadiusM,
        type.definition.location.geofenceRadiusM,
        settings.geofenceRadiusMeters,
      ),
      policy: type.definition.location.geofencePolicy,
      accuracyCapM: settings.geofenceAccuracyCapMeters,
    };
  }

  /** The type key of each account in `ids` the caller sees, for what a form's values refer to. */
  async typesSeen(
    tx: TenantTx,
    access: Access,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: accounts.id, type: accountTypes.key })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(
        and(
          eq(accounts.tenantId, access.tenantId),
          inArray(accounts.id, [...ids]),
          await this.reach(tx, access),
        ),
      );
    return new Map(rows.map((row) => [row.id, row.type]));
  }

  /** The accounts with these codes that the caller sees, by code (for imports). */
  async seenByCode(
    tx: TenantTx,
    access: Access,
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, access.tenantId),
          inArray(accounts.code, [...codes]),
          await this.reach(tx, access),
        ),
      );
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  /** The IDs of an account's active contacts. */
  async activeContactIds(tx: TenantTx, tenantId: string, accountId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.accountId, accountId),
          eq(contacts.active, true),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  async get(tx: TenantTx, access: Access, id: string): Promise<AccountResult> {
    const [result] = await this.results(tx, access.tenantId, [await this.find(tx, access, id)]);
    return result!;
  }

  /**
   * Adds an account. Someone who manages accounts adds an active one, with its required slots
   * filled. Anyone else who may propose adds a `pending` one, for a type that allows it, and their
   * manager decides it (decision D38); the proposer fills a slot their designation allows, so the
   * account reaches them.
   */
  async create(
    tx: TenantTx,
    access: Access,
    input: CreateAccountBody,
    options: { asImport?: boolean; inactive?: boolean } = {},
  ): Promise<AccountResult> {
    const tenantId = access.tenantId;
    const type = await this.types.byKey(tx, tenantId, input.type);
    if (!type) throw invalidAt('type', 'There is no such type of account');
    if (!type.active) throw invalidAt('type', 'This type of account is switched off');
    const manages = access.permissions.has('account.manage') || options.asImport === true;
    if (!manages) {
      if (
        !access.permissions.has('account.propose') ||
        type.definition.creation !== 'field_users_with_approval'
      ) {
        throw new AppError('FORBIDDEN', "You can't add this type of account.");
      }
    }
    const status = !manages ? 'pending' : options.inactive ? 'inactive' : 'active';
    const today = await this.today(tx, tenantId);
    const issues: ErrorDetail[] = [];

    let code = input.code;
    if (!code && type.definition.code.mode === 'manual')
      issues.push(issueAt(['code'], 'Write a code'));
    if (code && (await this.codeTaken(tx, tenantId, code))) {
      throw new AppError('CONFLICT', 'Another account has this code.', [
        { path: 'code', issue: 'Another account has this code' },
      ]);
    }
    issues.push(...(await this.checkTerritory(tx, tenantId, input.territoryId)));
    if (input.parentId)
      issues.push(...(await this.checkParent(tx, tenantId, type, null, input.parentId)));
    const custom = checkValueChanges(type.definition.fields, today, null, input.custom ?? {});
    issues.push(...custom.issues);

    let holders = Object.entries(input.slots ?? {}).map(([slot, userId]) => ({ slot, userId }));
    if (!manages && holders.length === 0) holders = await this.proposerSlot(tx, access, type);
    issues.push(...(await this.checkHolders(tx, tenantId, type, holders, status === 'active')));
    if (issues.length > 0) throw invalid(issues);

    code ??= await this.types.nextCode(tx, tenantId, type);
    await tx.insert(accounts).values({
      id: input.id,
      tenantId,
      typeId: type.id,
      code,
      name: input.name,
      territoryId: input.territoryId,
      parentAccountId: input.parentId ?? null,
      address: input.address ?? {},
      ...(input.location
        ? {
            location: pointSql(input.location),
            locationStatus: manages ? ('verified' as const) : ('unverified' as const),
          }
        : {}),
      geofenceRadiusM: input.geofenceRadiusM ?? null,
      status,
      segments: accountSegments(type.definition, custom.values),
      custom: custom.values,
      createdBy: access.userId,
      updatedBy: access.userId,
    });
    if (holders.length > 0) {
      await tx.insert(accountSlots).values(
        holders.map(({ slot, userId }) => ({
          tenantId,
          accountId: input.id,
          slotKey: slot,
          userId,
          validFrom: today,
        })),
      );
    }
    const created = await this.get(tx, { ...access, scope: 'tenant' }, input.id);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: status === 'pending' ? 'account.proposed' : 'account.created',
      target: { type: 'account', id: input.id },
      after: created,
    });
    if (status === 'pending') {
      await this.approvals.request(
        tx,
        tenantId,
        access.userId,
        'new_account',
        input.id,
        userActor(access),
        { accountId: input.id },
      );
    }
    return created;
  }

  /**
   * Changes an account. Its slots change from a day on, today or later; a pending account is
   * decided through its approval, not switched on here.
   */
  async update(
    tx: TenantTx,
    access: Access,
    id: string,
    input: UpdateAccountBody,
  ): Promise<AccountResult> {
    const tenantId = access.tenantId;
    const row = await this.find(tx, access, id, true);
    const before = await this.get(tx, access, id);
    const type = await this.types.byId(tx, tenantId, row.typeId);
    const today = await this.today(tx, tenantId);
    const issues: ErrorDetail[] = [];
    if (input.status && row.status === 'pending') {
      throw new AppError('CONFLICT', 'This account waits for approval.', [
        { path: 'status', issue: 'Decide it in the approvals inbox' },
      ]);
    }
    if (input.code && input.code !== row.code && (await this.codeTaken(tx, tenantId, input.code))) {
      throw new AppError('CONFLICT', 'Another account has this code.', [
        { path: 'code', issue: 'Another account has this code' },
      ]);
    }
    if (input.territoryId && input.territoryId !== row.territoryId) {
      issues.push(...(await this.checkTerritory(tx, tenantId, input.territoryId)));
    }
    if (input.parentId) {
      issues.push(...(await this.checkParent(tx, tenantId, type, id, input.parentId)));
    }
    const custom = input.custom
      ? checkValueChanges(type.definition.fields, today, row.custom, input.custom)
      : { values: row.custom, issues: [] };
    issues.push(...custom.issues);
    const status = input.status ?? row.status;
    if (input.slots) {
      issues.push(
        ...(await this.checkSlotChanges(
          tx,
          tenantId,
          type,
          id,
          input.slots,
          today,
          status === 'active',
        )),
      );
    } else if (input.status === 'active' && row.status !== 'active') {
      const holders = await this.holdersOn(tx, tenantId, id, today);
      issues.push(...(await this.checkHolders(tx, tenantId, type, holders, true)));
    }
    if (issues.length > 0) throw invalid(issues);

    const segments = accountSegments(type.definition, custom.values);
    if (!input.slots && unchanged(row, input, status, custom.values, segments)) return before;
    if (input.slots) await this.applySlotChanges(tx, tenantId, id, input.slots, today);
    await tx
      .update(accounts)
      .set({
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.territoryId !== undefined ? { territoryId: input.territoryId } : {}),
        ...(input.parentId !== undefined ? { parentAccountId: input.parentId } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.location !== undefined
          ? input.location
            ? { location: pointSql(input.location), locationStatus: 'verified' as const }
            : { location: null, locationStatus: 'unverified' as const }
          : {}),
        ...(input.geofenceRadiusM !== undefined ? { geofenceRadiusM: input.geofenceRadiusM } : {}),
        status,
        custom: custom.values,
        segments,
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id)));
    const after = await this.get(tx, access, id);
    await this.audit.record(tx, tenantId, userActor(access), {
      action:
        input.slots && Object.keys(input).length === 1
          ? 'account.slots_changed'
          : 'account.updated',
      target: { type: 'account', id },
      before,
      after,
    });
    return after;
  }

  async overview(tx: TenantTx, access: Access, id: string): Promise<AccountOverview> {
    const tenantId = access.tenantId;
    const account = await this.get(tx, access, id);
    const assignments = await tx
      .select()
      .from(accountSlots)
      .where(and(eq(accountSlots.tenantId, tenantId), eq(accountSlots.accountId, id)))
      .orderBy(desc(accountSlots.validFrom), asc(accountSlots.slotKey));
    const people = await this.people.facts(
      tx,
      tenantId,
      assignments.map((entry) => entry.userId),
    );
    return {
      account,
      contacts: await this.contactsOf(tx, tenantId, id),
      assignments: assignments.map((entry) => ({
        slot: entry.slotKey,
        user: personRef(people, entry.userId),
        validFrom: entry.validFrom,
        validTo: entry.validTo,
      })),
      locationProposals: await this.proposalsOf(tx, tenantId, { accountId: id }),
      approvalId:
        account.status === 'pending'
          ? await this.approvals.pendingFor(tx, tenantId, 'new_account', id)
          : null,
    };
  }

  // Contacts.

  async addContact(
    tx: TenantTx,
    access: Access,
    accountId: string,
    input: CreateContactBody,
  ): Promise<ContactResult> {
    const tenantId = access.tenantId;
    const row = await this.find(tx, access, accountId);
    const type = await this.types.byId(tx, tenantId, row.typeId);
    if (!type.definition.contacts) {
      throw new AppError('CONFLICT', "This type of account doesn't hold contacts.");
    }
    const settings = await this.config.settings(tx, tenantId);
    await tx.insert(contacts).values({
      id: input.id,
      tenantId,
      accountId,
      name: input.name,
      role: input.role ?? null,
      phone: input.phone ? phone(input.phone, settings) : null,
      email: input.email ?? null,
      createdBy: access.userId,
      updatedBy: access.userId,
    });
    const [created] = await this.contactsOf(tx, tenantId, accountId, input.id);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'contact.created',
      target: { type: 'contact', id: input.id },
      after: created,
    });
    return created!;
  }

  async changeContact(
    tx: TenantTx,
    access: Access,
    accountId: string,
    contactId: string,
    input: UpdateContactBody,
  ): Promise<ContactResult> {
    const tenantId = access.tenantId;
    await this.find(tx, access, accountId);
    const [before] = await this.contactsOf(tx, tenantId, accountId, contactId);
    if (!before) throw notFound();
    const settings = await this.config.settings(tx, tenantId);
    await tx
      .update(contacts)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.phone !== undefined
          ? { phone: input.phone === null ? null : phone(input.phone, settings) }
          : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    const [after] = await this.contactsOf(tx, tenantId, accountId, contactId);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'contact.updated',
      target: { type: 'contact', id: contactId },
      before,
      after,
    });
    return after!;
  }

  private async contactsOf(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    contactId?: string,
  ): Promise<ContactResult[]> {
    return tx
      .select({
        id: contacts.id,
        accountId: contacts.accountId,
        name: contacts.name,
        role: contacts.role,
        phone: contacts.phone,
        email: contacts.email,
        active: contacts.active,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.accountId, accountId),
          contactId ? eq(contacts.id, contactId) : undefined,
        ),
      )
      .orderBy(asc(contacts.name), asc(contacts.id));
  }

  // Locations proposed from the field (M4).

  async proposeLocation(
    tx: TenantTx,
    access: Access,
    accountId: string,
    input: CreateLocationProposalBody,
  ): Promise<LocationProposalResult> {
    const tenantId = access.tenantId;
    const row = await this.find(tx, access, accountId, true);
    const type = await this.types.byId(tx, tenantId, row.typeId);
    if (!type.definition.location.fieldUsersMayPropose) {
      throw new AppError(
        'FORBIDDEN',
        "Locations of this type of account aren't proposed from the field.",
      );
    }
    // BR-34's rule for work on an account: it must be active.
    if (row.status !== 'active') {
      throw new AppError('CONFLICT', 'This account is not active.');
    }
    if (row.locationStatus === 'verified') {
      throw new AppError('CONFLICT', "This account's location is verified already.");
    }
    const proposedAt = new Date(input.proposedAt);
    // A phone whose clock runs ahead of ours can't vouch for the moment (BR-44 flags the rest).
    if (proposedAt.getTime() > Date.now() + CLOCK_AHEAD_MS) {
      throw invalidAt('proposedAt', "The phone's clock is ahead. Set its time, and try again");
    }
    const fix = proposalFix(input, proposedAt);
    if (fix === 'inaccurate') {
      throw invalidAt('accuracy', 'Wait for a fix of 50 m or better');
    }
    if (fix === 'stale') throw invalidAt('capturedAt', 'Take a fresh fix, standing at the account');
    const [waiting] = await tx
      .select({ id: accountLocationProposals.id })
      .from(accountLocationProposals)
      .where(
        and(
          eq(accountLocationProposals.tenantId, tenantId),
          eq(accountLocationProposals.accountId, accountId),
          eq(accountLocationProposals.status, 'pending'),
        ),
      );
    if (waiting) throw new AppError('CONFLICT', 'A location for this account waits for approval.');
    await tx.insert(accountLocationProposals).values({
      id: input.id,
      tenantId,
      accountId,
      proposedBy: access.userId,
      point: pointSql({ lat: input.lat, lng: input.lng }),
      accuracy: input.accuracy,
      capturedAt: new Date(input.capturedAt),
    });
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      access.userId,
      'account_location_change',
      input.id,
      userActor(access),
      { accountId },
    );
    await tx
      .update(accountLocationProposals)
      .set({ workflowInstanceId: approvalId })
      .where(
        and(
          eq(accountLocationProposals.tenantId, tenantId),
          eq(accountLocationProposals.id, input.id),
        ),
      );
    const [proposal] = await this.proposalsOf(tx, tenantId, { id: input.id });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'account.location_proposed',
      target: { type: 'account', id: accountId },
      after: proposal,
    });
    return proposal!;
  }

  async proposalsOf(
    tx: TenantTx,
    tenantId: string,
    where: { accountId?: string; id?: string; ids?: readonly string[] },
  ): Promise<LocationProposalResult[]> {
    const rows = await tx
      .select({
        id: accountLocationProposals.id,
        accountId: accountLocationProposals.accountId,
        point: pointOf(accountLocationProposals.point),
        accuracy: accountLocationProposals.accuracy,
        capturedAt: accountLocationProposals.capturedAt,
        status: accountLocationProposals.status,
        proposedBy: accountLocationProposals.proposedBy,
        approvalId: accountLocationProposals.workflowInstanceId,
        createdAt: accountLocationProposals.createdAt,
      })
      .from(accountLocationProposals)
      .where(
        and(
          eq(accountLocationProposals.tenantId, tenantId),
          where.accountId ? eq(accountLocationProposals.accountId, where.accountId) : undefined,
          where.id ? eq(accountLocationProposals.id, where.id) : undefined,
          where.ids ? inArray(accountLocationProposals.id, [...where.ids]) : undefined,
        ),
      )
      .orderBy(desc(accountLocationProposals.createdAt));
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.map((row) => row.proposedBy),
    );
    return rows.map((row) => ({
      ...row,
      point: row.point!,
      capturedAt: row.capturedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      proposedBy: personRef(people, row.proposedBy),
    }));
  }

  // Decisions, from the approvals inbox.

  /** A proposed account: approved, it becomes active; rejected, it stays as an inactive record. */
  async decideAccount(
    tx: TenantTx,
    by: Access,
    id: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const before = await this.row(tx, by.tenantId, id, true);
    const status = outcome === 'approved' ? 'active' : 'inactive';
    await tx
      .update(accounts)
      .set({ status, updatedAt: new Date(), updatedBy: by.userId })
      .where(and(eq(accounts.tenantId, by.tenantId), eq(accounts.id, id)));
    await this.audit.record(tx, by.tenantId, userActor(by), {
      action: 'account.updated',
      target: { type: 'account', id },
      before: { status: before.status },
      after: { status },
    });
  }

  /** A proposed location: approved, it becomes the account's, verified. */
  async decideLocation(
    tx: TenantTx,
    by: Access,
    proposalId: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const tenantId = by.tenantId;
    const [proposal] = await tx
      .select({
        accountId: accountLocationProposals.accountId,
        point: accountLocationProposals.point,
      })
      .from(accountLocationProposals)
      .where(
        and(
          eq(accountLocationProposals.tenantId, tenantId),
          eq(accountLocationProposals.id, proposalId),
        ),
      );
    if (!proposal) throw notFound();
    await tx
      .update(accountLocationProposals)
      .set({ status: outcome, decidedAt: new Date() })
      .where(
        and(
          eq(accountLocationProposals.tenantId, tenantId),
          eq(accountLocationProposals.id, proposalId),
        ),
      );
    if (outcome !== 'approved') return;
    const before = await this.row(tx, tenantId, proposal.accountId, true);
    await tx
      .update(accounts)
      .set({
        location: sql`(select point from ${accountLocationProposals}
          where tenant_id = ${tenantId} and id = ${proposalId})`,
        locationStatus: 'verified',
        updatedAt: new Date(),
        updatedBy: by.userId,
      })
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, proposal.accountId)));
    const after = await this.row(tx, tenantId, proposal.accountId);
    await this.audit.record(tx, tenantId, userActor(by), {
      action: 'account.updated',
      target: { type: 'account', id: proposal.accountId },
      before: { location: before.location, locationStatus: before.locationStatus },
      after: { location: after.location, locationStatus: after.locationStatus },
    });
  }

  /** What each proposed account or location is, for the inbox. */
  async subjects(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, { title: string; accountId: string }>> {
    if (accountIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...new Set(accountIds)])));
    return new Map(
      rows.map((row) => [row.id, { title: `${row.name} (${row.code})`, accountId: row.id }]),
    );
  }

  // Nightly upkeep.

  /**
   * Re-tags every account's segments, and restamps accounts whose slot holders change today, so
   * phones that keep them hear of it (spec 5.5, decision D40). Running it twice changes nothing.
   */
  async daily(tx: TenantTx, tenantId: string, today: string): Promise<number> {
    let changed = 0;
    for (const type of await this.types.list(tx, tenantId)) {
      const rows = await tx
        .select({ id: accounts.id, custom: accounts.custom, segments: accounts.segments })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.typeId, type.id)));
      for (const row of rows) {
        const segments = accountSegments(type.definition, row.custom);
        if (segments.join(',') === row.segments.join(',')) continue;
        await tx
          .update(accounts)
          .set({ segments, updatedAt: new Date() })
          .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, row.id)));
        changed += 1;
      }
    }
    const starting = await tx
      .select({ id: accountSlots.accountId })
      .from(accountSlots)
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          or(eq(accountSlots.validFrom, today), eq(accountSlots.validTo, today)),
        ),
      );
    const ids = [...new Set(starting.map((row) => row.id))];
    if (ids.length > 0) {
      await tx
        .update(accounts)
        .set({ updatedAt: new Date() })
        .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
    }
    return changed + ids.length;
  }

  // The pieces.

  async row(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<AccountRow> {
    const query = selectRows(tx).where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  /** Accounts as the API answers with them, today's slot holders included. */
  async results(
    tx: TenantTx,
    tenantId: string,
    rows: readonly AccountRow[],
  ): Promise<AccountResult[]> {
    if (rows.length === 0) return [];
    const today = await this.today(tx, tenantId);
    const types = new Map((await this.types.list(tx, tenantId)).map((type) => [type.id, type]));
    const slots = await tx
      .select({
        accountId: accountSlots.accountId,
        slot: accountSlots.slotKey,
        userId: accountSlots.userId,
        validFrom: accountSlots.validFrom,
      })
      .from(accountSlots)
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          inArray(
            accountSlots.accountId,
            rows.map((row) => row.id),
          ),
          slotsOn(today),
        ),
      )
      .orderBy(asc(accountSlots.slotKey));
    const people = await this.people.facts(
      tx,
      tenantId,
      slots.map((slot) => slot.userId),
    );
    const territories = await this.territories.byIds(
      tx,
      tenantId,
      rows.map((row) => row.territoryId),
    );
    const parentIds = rows.flatMap((row) => (row.parentAccountId ? [row.parentAccountId] : []));
    const parents = new Map(
      parentIds.length === 0
        ? []
        : (
            await tx
              .select({ id: accounts.id, code: accounts.code, name: accounts.name })
              .from(accounts)
              .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, parentIds)))
          ).map((parent) => [parent.id, parent]),
    );
    return rows.map((row) => {
      const type = types.get(row.typeId)!;
      const holders = slots.filter((slot) => slot.accountId === row.id);
      const territory = territories.get(row.territoryId);
      return {
        id: row.id,
        type: type.key,
        code: row.code,
        name: row.name,
        territory: {
          id: row.territoryId,
          code: territory?.code ?? '',
          name: territory?.name ?? '',
        },
        parent: row.parentAccountId ? (parents.get(row.parentAccountId) ?? null) : null,
        address: row.address,
        location: row.location,
        geofenceRadiusM: row.geofenceRadiusM,
        locationStatus: row.locationStatus,
        status: row.status,
        segments: row.segments,
        custom: row.custom,
        slots: holders.map((holder) => ({
          slot: holder.slot,
          user: personRef(people, holder.userId),
          validFrom: holder.validFrom,
        })),
        primarySlot: primaryAssignee(type.definition, holders)?.slot ?? null,
        missingSlots: type.definition.slots
          .filter((slot) => slot.required && !holders.some((holder) => holder.slot === slot.key))
          .map((slot) => slot.key),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** Everything, nothing, or a hash of the accounts the caller sees today, for phones' sync scopes. */
  async reachHash(tx: TenantTx, access: Access): Promise<string> {
    if (!access.permissions.has('account.view')) return 'none';
    if (access.scope === 'tenant') return 'tenant';
    const [row] = await tx
      .select({
        hash: sql<string>`md5(coalesce(string_agg(${accounts.id}::text, ',' order by ${accounts.id}), ''))`,
      })
      .from(accounts)
      .where(and(eq(accounts.tenantId, access.tenantId), await this.reach(tx, access)));
    return row!.hash;
  }

  /** The IDs, as text, of the accounts the caller sees, as a subquery for another module's query. */
  async reachIds(tx: TenantTx, access: Access): Promise<SQL> {
    if (!access.permissions.has('account.view')) return sql`(select null::text where false)`;
    return sql`(select ${accounts.id}::text from ${accounts}
      where ${and(eq(accounts.tenantId, access.tenantId), await this.reach(tx, access))})`;
  }

  /** Accounts by ID as the metric engine groups them: their type and segments. */
  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, { id: string; typeKey: string; segments: string[] }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: accounts.id, typeKey: accountTypes.key, segments: accounts.segments })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...new Set(ids)])));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Accounts by ID as other records name them: code and name, whoever sees them. */
  async refs(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, { id: string; code: string; name: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...new Set(ids)])));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Accounts by ID as reports show them: code, name, type and segments. */
  async forReport(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, { code: string; name: string; typeKey: string; segments: string[] }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        typeKey: accountTypes.key,
        segments: accounts.segments,
      })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...new Set(ids)])));
    return new Map(rows.map(({ id, ...row }) => [id, row]));
  }

  /**
   * Coverage (M18): each account a person among `people` fills a slot of on a day, by person
   * and account code, a page at a time.
   */
  async slotsHeld(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    day: string,
    offset: number,
    limit: number,
  ): Promise<{ userId: string; accountId: string }[]> {
    return tx
      .selectDistinct({
        userId: accountSlots.userId,
        accountId: accountSlots.accountId,
        code: accounts.code,
      })
      .from(accountSlots)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, accountSlots.tenantId), eq(accounts.id, accountSlots.accountId)),
      )
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          sql`${accountSlots.userId} in (${people})`,
          lte(accountSlots.validFrom, day),
          or(isNull(accountSlots.validTo), gt(accountSlots.validTo, day)),
        ),
      )
      .orderBy(asc(accountSlots.userId), asc(accounts.code), asc(accountSlots.accountId))
      .offset(offset)
      .limit(limit + 1);
  }

  /** Which of `ids` are the tenant's accounts, whoever sees them. */
  async existing(tx: TenantTx, tenantId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...ids])));
    return new Set(rows.map((row) => row.id));
  }

  async codeTaken(tx: TenantTx, tenantId: string, code: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), sql`lower(${accounts.code}) = lower(${code})`));
    return row !== undefined;
  }

  async checkTerritory(
    tx: TenantTx,
    tenantId: string,
    territoryId: string,
  ): Promise<ErrorDetail[]> {
    const territory = (await this.territories.byIds(tx, tenantId, [territoryId])).get(territoryId);
    if (!territory) return [issueAt(['territoryId'], 'There is no such territory')];
    if (!territory.active) return [issueAt(['territoryId'], 'This territory is switched off')];
    return [];
  }

  /** A parent of a type this type allows, active, and never the account itself or its child. */
  async checkParent(
    tx: TenantTx,
    tenantId: string,
    type: TypeRecord,
    accountId: string | null,
    parentId: string,
  ): Promise<ErrorDetail[]> {
    const [parent] = await tx
      .select({ id: accounts.id, status: accounts.status, typeKey: accountTypes.key })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, parentId)));
    if (!parent) return [issueAt(['parentId'], 'There is no such account')];
    if (!type.definition.parentTypes.includes(parent.typeKey)) {
      return [issueAt(['parentId'], "This type of account can't belong to that one")];
    }
    if (parent.status !== 'active') return [issueAt(['parentId'], 'That account is not active')];
    if (accountId) {
      // Walking up from the parent must never reach the account itself.
      let current: string | null = parentId;
      for (let depth = 0; current && depth < 20; depth += 1) {
        if (current === accountId)
          return [issueAt(['parentId'], 'An account cannot belong to itself')];
        const [up]: { parent: string | null }[] = await tx
          .select({ parent: accounts.parentAccountId })
          .from(accounts)
          .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, current)));
        current = up?.parent ?? null;
      }
    }
    return [];
  }

  /**
   * The active accounts these people held a slot of at any time in a date range, for coverage
   * (spec 5.7): who held which, with its type and segments.
   */
  async heldDuring(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ userId: string; accountId: string; typeKey: string; segments: string[] }[]> {
    if (userIds.length === 0) return [];
    return tx
      .selectDistinct({
        userId: accountSlots.userId,
        accountId: accounts.id,
        typeKey: accountTypes.key,
        segments: accounts.segments,
      })
      .from(accountSlots)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, accountSlots.tenantId), eq(accounts.id, accountSlots.accountId)),
      )
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          inArray(accountSlots.userId, [...new Set(userIds)]),
          eq(accounts.status, 'active'),
          lte(accountSlots.validFrom, to),
          or(isNull(accountSlots.validTo), gt(accountSlots.validTo, from)),
        ),
      );
  }

  /**
   * The located accounts the caller sees, for maps (M17): code, name, type and place, up to
   * `limit`, and whether there were more.
   */
  async pins(tx: TenantTx, access: Access, limit: number) {
    const rows = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accountTypes.key,
        location: pointOf(accounts.location),
      })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(
        and(
          eq(accounts.tenantId, access.tenantId),
          eq(accounts.status, 'active'),
          sql`${accounts.location} is not null`,
          await this.reach(tx, access),
        ),
      )
      .orderBy(asc(accounts.name), asc(accounts.id))
      .limit(limit + 1);
    return {
      items: rows
        .slice(0, limit)
        .flatMap((row) => (row.location ? [{ ...row, location: row.location }] : [])),
      truncated: rows.length > limit,
    };
  }

  /** The active person in one of an account's slots today, on the tenant's clock (spec 5.9). */
  async slotHolder(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    slot: string,
  ): Promise<string | null> {
    const today = await this.today(tx, tenantId);
    const holder = (await this.holdersOn(tx, tenantId, accountId, today)).find(
      (entry) => entry.slot === slot,
    );
    if (!holder) return null;
    const person = (await this.people.facts(tx, tenantId, [holder.userId])).get(holder.userId);
    return person?.status === 'active' ? person.id : null;
  }

  /** Today's holders of an account's slots. */
  async holdersOn(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    day: string,
  ): Promise<{ slot: string; userId: string }[]> {
    return tx
      .select({ slot: accountSlots.slotKey, userId: accountSlots.userId })
      .from(accountSlots)
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          eq(accountSlots.accountId, accountId),
          slotsOn(day),
        ),
      );
  }

  /** Checks holders against the type's slots: people who exist, are active, and fit the slot. */
  async checkHolders(
    tx: TenantTx,
    tenantId: string,
    type: TypeRecord,
    holders: readonly { slot: string; userId: string }[],
    complete: boolean,
  ): Promise<ErrorDetail[]> {
    const people = await this.people.facts(
      tx,
      tenantId,
      holders.map((holder) => holder.userId),
    );
    const issues: ErrorDetail[] = [];
    const known: SlotHolder[] = [];
    for (const holder of holders) {
      const person = people.get(holder.userId);
      if (!person) issues.push(issueAt(['slots', holder.slot], 'There is no such person'));
      else if (person.status !== 'active') {
        issues.push(issueAt(['slots', holder.slot], 'This person is not active'));
      } else known.push({ ...holder, designation: person.designation });
    }
    return [...issues, ...checkSlots(type.definition, known, { complete })];
  }

  /** The slot a proposer fills: the lowest-priority one their designation fits, if any. */
  private async proposerSlot(tx: TenantTx, access: Access, type: TypeRecord) {
    const me = (await this.people.facts(tx, access.tenantId, [access.userId])).get(access.userId);
    const fits = [...type.definition.slots]
      .sort((a, b) => b.priority - a.priority)
      .find((slot) => me && slot.designations.includes(me.designation));
    return fits ? [{ slot: fits.key, userId: access.userId }] : [];
  }

  private async checkSlotChanges(
    tx: TenantTx,
    tenantId: string,
    type: TypeRecord,
    accountId: string,
    changes: SlotChanges,
    today: string,
    complete: boolean,
  ): Promise<ErrorDetail[]> {
    const from = changes.from ?? today;
    if (from < today) return [issueAt(['slots', 'from'], 'Choose today or a later day')];
    const then = new Map(
      (await this.holdersOn(tx, tenantId, accountId, from)).map((holder) => [
        holder.slot,
        holder.userId,
      ]),
    );
    for (const [slot, userId] of Object.entries(changes.holders)) {
      if (userId === null) then.delete(slot);
      else then.set(slot, userId);
    }
    return this.checkHolders(
      tx,
      tenantId,
      type,
      [...then].map(([slot, userId]) => ({ slot, userId })),
      complete,
    );
  }

  /**
   * Changes who fills each named slot from a day on: the holder on that day stops the day before,
   * and anything planned from that day on is replaced.
   */
  async applySlotChanges(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    changes: SlotChanges,
    today: string,
  ): Promise<void> {
    const from = changes.from ?? today;
    for (const [slot, userId] of Object.entries(changes.holders)) {
      const ofSlot = and(
        eq(accountSlots.tenantId, tenantId),
        eq(accountSlots.accountId, accountId),
        eq(accountSlots.slotKey, slot),
      );
      await tx.delete(accountSlots).where(and(ofSlot, gte(accountSlots.validFrom, from)));
      await tx
        .update(accountSlots)
        .set({ validTo: from })
        .where(and(ofSlot, or(isNull(accountSlots.validTo), gt(accountSlots.validTo, from))));
      if (userId) {
        await tx
          .insert(accountSlots)
          .values({ tenantId, accountId, slotKey: slot, userId, validFrom: from });
      }
    }
  }
}

/** Whether a change would leave the account exactly as it is, so nothing is written. */
function unchanged(
  row: AccountRow,
  input: UpdateAccountBody,
  status: AccountRow['status'],
  custom: Record<string, unknown>,
  segments: string[],
): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const location = (point: GeoPoint | null | undefined) =>
    point ? [point.lat.toFixed(7), point.lng.toFixed(7)] : null;
  return (
    (input.code === undefined || input.code === row.code) &&
    (input.name === undefined || input.name === row.name) &&
    (input.territoryId === undefined || input.territoryId === row.territoryId) &&
    (input.parentId === undefined || input.parentId === row.parentAccountId) &&
    (input.address === undefined || same(sorted(input.address), sorted(row.address))) &&
    (input.location === undefined || same(location(input.location), location(row.location))) &&
    (input.geofenceRadiusM === undefined || input.geofenceRadiusM === row.geofenceRadiusM) &&
    status === row.status &&
    same(sorted(custom), sorted(row.custom)) &&
    same(segments, row.segments) &&
    (input.location === undefined || input.location === null || row.locationStatus === 'verified')
  );
}

function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function containing(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function personRef(people: Map<string, { code: string; name: string }>, id: string) {
  const person = people.get(id);
  return { id, code: person?.code ?? '', name: person?.name ?? '' };
}

function phone(raw: string, settings: TenantSettings): string {
  const e164 = normalisePhone(raw, settings.defaultCountry);
  if (!e164) throw invalidAt('phone', 'Write a mobile number, such as 98765 43210');
  return e164;
}
