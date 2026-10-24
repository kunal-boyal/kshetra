import { Injectable } from '@nestjs/common';
import {
  AppError,
  canGrant,
  type CreateUserBody,
  type DataScope,
  type DeviceHealth,
  type DeviceSummary,
  type MeResult,
  newId,
  normalisePhone,
  TENANT_PERMISSIONS,
  type TenantPermission,
  type TenantSettings,
  todayIn,
  type UpdateUserBody,
  type UserListQuery,
  type UserListResult,
  type UserResult,
  type UserView,
} from '@thelamp/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  like,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { designations, devices, roles, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AuditLog, userActor } from '../../platform/audit';
import { Outbox } from '../../platform/outbox';
import {
  type Actor,
  actorId,
  auditActor,
  invalid,
  notFound,
  outOfScope,
  SYSTEM,
  uniqueViolation,
} from './actor';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { ReportingTree } from './reporting-tree';
import { Scopes } from './scopes';
import { UserFieldsService } from './user-fields.service';

type UserRow = typeof users.$inferSelect;

interface RoleRef {
  id: string;
  key: string;
  scope: DataScope;
  permissions: TenantPermission[];
}

const managers = alias(users, 'managers');

const selection = {
  id: users.id,
  code: users.code,
  name: users.name,
  phone: users.phoneE164,
  email: users.email,
  designation: designations.key,
  role: roles.key,
  managerId: users.managerId,
  managerCode: managers.code,
  managerName: managers.name,
  joiningDate: users.joiningDate,
  exitDate: users.exitDate,
  calendarKey: users.calendarKey,
  status: users.status,
  custom: users.custom,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

interface SelectedUser extends Omit<
  UserResult,
  'createdAt' | 'updatedAt' | 'manager' | 'territories'
> {
  managerCode: string | null;
  managerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toResult(row: SelectedUser, territories: UserResult['territories']): UserResult {
  const { managerCode, managerName, ...user } = row;
  return {
    ...user,
    manager:
      row.managerId && managerCode !== null && managerName !== null
        ? { id: row.managerId, code: managerCode, name: managerName }
        : null,
    territories,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `value` anywhere in a column, with the LIKE wildcards in it taken literally. */
function containing(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function parsePhone(raw: string, country: TenantSettings['defaultCountry']): string {
  const phone = normalisePhone(raw, country);
  if (!phone) throw invalid('phone', 'Not a valid mobile number');
  return phone;
}

const ownRoleOrStatus = () =>
  new AppError(
    'FORBIDDEN',
    'You cannot change your own role or status. Ask another admin to do it.',
  );

const beyondOwnAccess = () =>
  new AppError('FORBIDDEN', 'You cannot give or change access that you do not have yourself.');

/**
 * Users (spec 5.3, module M3). The rules: codes and phone numbers are unique in the tenant; a
 * manager is active and holds a designation that can have reports; the reporting tree has no
 * loops; and nobody gives access they do not hold. A change of phone, role or status signs the
 * user out everywhere (BR-39), and the directory hears of every change to who can sign in.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly scopes: Scopes,
    private readonly tree: ReportingTree,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly territories: TerritoriesService,
    private readonly fields: UserFieldsService,
  ) {}

  async list(tx: TenantTx, access: Access, query: UserListQuery): Promise<UserListResult> {
    let search: SQL | undefined;
    if (query.q) {
      // A number matches mobile numbers too; it is never logged, as query strings never are.
      const digits = query.q.replace(/[\s()+-]/g, '');
      search = or(
        ilike(users.name, containing(query.q)),
        ilike(users.code, containing(query.q)),
        /^\d{3,}$/.test(digits) ? like(users.phoneE164, containing(digits)) : undefined,
      );
    }
    const rows = await this.query(tx)
      .where(
        and(
          eq(users.tenantId, access.tenantId),
          await this.scopes.users(tx, access),
          query.status ? eq(users.status, query.status) : undefined,
          query.designation ? eq(designations.key, query.designation) : undefined,
          query.managerId ? eq(users.managerId, query.managerId) : undefined,
          search,
          query.cursor ? gt(users.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(users.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: await this.views(tx, access.tenantId, await this.results(tx, access.tenantId, page)),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  async get(tx: TenantTx, access: Access, id: string): Promise<UserView> {
    const user = await this.read(tx, access.tenantId, id);
    if (!(await this.scopes.reaches(tx, access, id))) throw outOfScope();
    const [view] = await this.views(tx, access.tenantId, [user]);
    return view!;
  }

  /** `GET /v1/me`: the caller's own profile and access. */
  async me(tx: TenantTx, access: Access): Promise<MeResult> {
    const user = await this.read(tx, access.tenantId, access.userId);
    return {
      userId: access.userId,
      tenantId: access.tenantId,
      cell: access.cell,
      code: user.code,
      name: user.name,
      designation: user.designation,
      role: access.roleKey,
      scope: access.scope,
      permissions: TENANT_PERMISSIONS.filter((permission) => access.permissions.has(permission)),
      deviceId: access.deviceId ?? null,
    };
  }

  async create(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    input: CreateUserBody,
  ): Promise<UserResult> {
    const phone = input.phone === undefined ? null : await this.phone(tx, tenantId, input.phone);
    const designation = await this.designation(tx, tenantId, input.designation);
    const role = input.role
      ? await this.roleByKey(tx, tenantId, input.role)
      : await this.roleById(tx, tenantId, designation.defaultRoleId);
    checkDates(input.joiningDate ?? null, input.exitDate ?? null);
    if (actor !== SYSTEM) {
      if (!canGrant(actor, role)) throw beyondOwnAccess();
      // Someone who reaches less than the whole tenant can only add people below someone they reach.
      if (
        actor.scope !== 'tenant' &&
        (input.managerId === null || !(await this.scopes.reaches(tx, actor, input.managerId)))
      ) {
        throw outOfScope();
      }
    }
    await this.checkUnique(tx, tenantId, null, input.code, phone);
    if (input.managerId !== null) {
      await this.tree.lock(tx, tenantId);
      await this.checkManager(tx, tenantId, null, input.managerId);
    }
    const custom = await this.fields.values(tx, tenantId, null, input.custom);

    const id = newId();
    const by = actorId(actor);
    await this.write(() =>
      tx.insert(users).values({
        id,
        tenantId,
        code: input.code,
        name: input.name,
        phoneE164: phone,
        email: input.email?.toLowerCase() ?? null,
        designationId: designation.id,
        roleId: role.id,
        managerId: input.managerId,
        joiningDate: input.joiningDate ?? null,
        exitDate: input.exitDate ?? null,
        custom,
        createdBy: by,
        updatedBy: by,
      }),
    );
    await this.tree.add(tx, tenantId, id, input.managerId);
    if (input.territoryIds.length > 0) {
      await this.territories.replaceAttachments(
        tx,
        tenantId,
        id,
        input.territoryIds,
        await this.today(tx, tenantId),
      );
    }
    const created = await this.read(tx, tenantId, id);
    await this.audit.record(tx, tenantId, auditActor(actor), {
      action: 'user.created',
      target: { type: 'user', id },
      after: created,
    });
    await this.outbox.publish(tx, tenantId, 'user.created', id, {
      userId: id,
      phone,
      status: 'active',
      authRevision: 0,
    });
    return created;
  }

  async update(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    id: string,
    input: UpdateUserBody,
  ): Promise<UserResult> {
    const current = await this.lock(tx, tenantId, id);
    if (actor !== SYSTEM) {
      if (!(await this.scopes.reaches(tx, actor, id))) throw outOfScope();
      if (!canGrant(actor, await this.roleById(tx, tenantId, current.roleId))) {
        throw beyondOwnAccess();
      }
    }

    const phone =
      input.phone === undefined
        ? current.phoneE164
        : input.phone === null
          ? null
          : await this.phone(tx, tenantId, input.phone);
    const designation = input.designation
      ? await this.designation(tx, tenantId, input.designation)
      : undefined;
    let roleId = current.roleId;
    if (input.role) {
      const role = await this.roleByKey(tx, tenantId, input.role);
      if (actor !== SYSTEM && !canGrant(actor, role)) throw beyondOwnAccess();
      roleId = role.id;
    }
    const managerId = input.managerId === undefined ? current.managerId : input.managerId;
    const status = input.status ?? current.status;
    if (
      actor !== SYSTEM &&
      actor.userId === id &&
      (roleId !== current.roleId || status !== current.status)
    ) {
      throw ownRoleOrStatus();
    }
    const joiningDate = input.joiningDate === undefined ? current.joiningDate : input.joiningDate;
    const exitDate = input.exitDate === undefined ? current.exitDate : input.exitDate;
    checkDates(joiningDate, exitDate);

    const code = input.code ?? current.code;
    await this.checkUnique(
      tx,
      tenantId,
      id,
      code === current.code ? null : code,
      phone === current.phoneE164 ? null : phone,
    );

    const managerChanged = managerId !== current.managerId;
    if (managerChanged || (status === 'active' && current.status === 'inactive')) {
      await this.tree.lock(tx, tenantId);
      if (managerChanged && actor !== SYSTEM && actor.scope !== 'tenant') {
        // Moving someone to the top, or below someone the actor does not reach, takes them out of
        // the actor's reach.
        if (managerId === null || !(await this.scopes.reaches(tx, actor, managerId))) {
          throw outOfScope();
        }
      }
      if (managerId !== null) {
        await this.checkManager(tx, tenantId, managerChanged ? id : null, managerId);
      }
    }
    if (
      (status === 'inactive' && current.status === 'active') ||
      (designation && !designation.canHaveReports)
    ) {
      await this.refuseWhileManaging(
        tx,
        tenantId,
        id,
        status === 'inactive' ? 'status' : 'designation',
      );
    }

    const custom =
      input.custom === undefined
        ? current.custom
        : await this.fields.values(tx, tenantId, current.custom, input.custom);

    const changes: Partial<typeof users.$inferInsert> = {
      ...(code !== current.code ? { code } : {}),
      ...(input.name !== undefined && input.name !== current.name ? { name: input.name } : {}),
      ...(phone !== current.phoneE164 ? { phoneE164: phone } : {}),
      ...(input.email !== undefined && (input.email?.toLowerCase() ?? null) !== current.email
        ? { email: input.email?.toLowerCase() ?? null }
        : {}),
      ...(designation && designation.id !== current.designationId
        ? { designationId: designation.id }
        : {}),
      ...(roleId !== current.roleId ? { roleId } : {}),
      ...(managerChanged ? { managerId } : {}),
      ...(joiningDate !== current.joiningDate ? { joiningDate } : {}),
      ...(exitDate !== current.exitDate ? { exitDate } : {}),
      ...(status !== current.status ? { status } : {}),
      ...(JSON.stringify(custom) !== JSON.stringify(current.custom) ? { custom } : {}),
    };
    const before = await this.read(tx, tenantId, id);
    if (Object.keys(changes).length === 0) return before;

    // A change of phone, role or status ends every session the user has (BR-39).
    const revise = 'phoneE164' in changes || 'roleId' in changes || 'status' in changes;
    const authRevision = current.authRevision + (revise ? 1 : 0);
    await this.write(() =>
      tx
        .update(users)
        .set({ ...changes, authRevision, updatedAt: new Date(), updatedBy: actorId(actor) })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, id))),
    );
    if (managerChanged) await this.tree.move(tx, tenantId, id, managerId);
    const after = await this.read(tx, tenantId, id);
    await this.audit.record(tx, tenantId, auditActor(actor), {
      action: 'user.updated',
      target: { type: 'user', id },
      before,
      after,
    });
    const deactivated = status === 'inactive' && current.status === 'active';
    await this.outbox.publish(tx, tenantId, deactivated ? 'user.deactivated' : 'user.updated', id, {
      userId: id,
      phone,
      status,
      authRevision,
    });
    return after;
  }

  /**
   * Checks a move a transfer will make on a later day, by the rules `update` applies: the actor
   * may change this person and grant the role, the designation and role exist, and the manager
   * is active, can have reports, makes no loop and is someone the actor reaches. The day of the
   * transfer checks everything again.
   */
  async checkMove(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    id: string,
    move: {
      managerId?: string | null | undefined;
      designation?: string | undefined;
      role?: string | undefined;
    },
  ): Promise<void> {
    const current = await this.lock(tx, tenantId, id);
    if (actor !== SYSTEM) {
      if (!(await this.scopes.reaches(tx, actor, id))) throw outOfScope();
      if (!canGrant(actor, await this.roleById(tx, tenantId, current.roleId))) {
        throw beyondOwnAccess();
      }
    }
    if (move.designation) await this.designation(tx, tenantId, move.designation);
    if (move.role) {
      const role = await this.roleByKey(tx, tenantId, move.role);
      if (actor !== SYSTEM) {
        if (!canGrant(actor, role)) throw beyondOwnAccess();
        if (actor.userId === id && role.id !== current.roleId) throw ownRoleOrStatus();
      }
    }
    if (move.managerId !== undefined && move.managerId !== current.managerId) {
      if (actor !== SYSTEM && actor.scope !== 'tenant') {
        if (move.managerId === null || !(await this.scopes.reaches(tx, actor, move.managerId))) {
          throw outOfScope();
        }
      }
      if (move.managerId !== null) await this.checkManager(tx, tenantId, id, move.managerId);
    }
  }

  /**
   * Frees the user's phone so they can bind another (BR-38), and signs them out everywhere. Only
   * someone whose scope reaches them may do it, and never for themselves.
   */
  async resetDevice(tx: TenantTx, access: Access, id: string): Promise<void> {
    const user = await this.lock(tx, access.tenantId, id);
    if (access.userId === id) {
      throw new AppError(
        'FORBIDDEN',
        'You cannot reset your own device. Ask your manager or an admin to do it.',
      );
    }
    if (!(await this.scopes.reaches(tx, access, id))) throw outOfScope();
    const revoked = await tx
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(devices.tenantId, access.tenantId),
          eq(devices.userId, id),
          isNull(devices.revokedAt),
        ),
      )
      .returning({ id: devices.id });
    await this.revise(tx, access, user);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'user.device_reset',
      target: { type: 'user', id },
      after: { revokedDevices: revoked.map((device) => device.id) },
    });
  }

  /** Ends every session the user has, on every device (BR-39). */
  async signOutEverywhere(tx: TenantTx, access: Access, id: string): Promise<void> {
    const user = await this.lock(tx, access.tenantId, id);
    if (!(await this.scopes.reaches(tx, access, id))) throw outOfScope();
    await this.revise(tx, access, user);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'user.signed_out_everywhere',
      target: { type: 'user', id },
    });
  }

  /** Moves the user's auth revision on, so every token they hold fails on its next use. */
  private async revise(tx: TenantTx, access: Access, user: UserRow): Promise<void> {
    const authRevision = user.authRevision + 1;
    await tx
      .update(users)
      .set({ authRevision, updatedAt: new Date(), updatedBy: access.userId })
      .where(and(eq(users.tenantId, user.tenantId), eq(users.id, user.id)));
    await this.outbox.publish(tx, user.tenantId, 'user.updated', user.id, {
      userId: user.id,
      phone: user.phoneE164,
      status: user.status,
      authRevision,
    });
  }

  private async checkManager(
    tx: TenantTx,
    tenantId: string,
    userId: string | null,
    managerId: string,
  ): Promise<void> {
    const [manager] = await tx
      .select({ status: users.status, canHaveReports: designations.canHaveReports })
      .from(users)
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .where(and(eq(users.tenantId, tenantId), eq(users.id, managerId)));
    if (!manager) throw invalid('managerId', 'There is no user with this ID');
    if (userId && (await this.tree.isUnder(tx, tenantId, managerId, userId))) {
      throw invalid('managerId', 'This would make a reporting loop');
    }
    if (manager.status !== 'active') throw invalid('managerId', 'This manager is inactive');
    if (!manager.canHaveReports) {
      throw invalid('managerId', "This manager's designation cannot have reports");
    }
  }

  /** A manager keeps their status and a designation that can have reports while people report to them. */
  private async refuseWhileManaging(
    tx: TenantTx,
    tenantId: string,
    id: string,
    field: 'status' | 'designation',
  ): Promise<void> {
    const [reports] = await tx
      .select({ count: count() })
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.managerId, id), eq(users.status, 'active')),
      );
    if ((reports?.count ?? 0) > 0) {
      throw new AppError(
        'CONFLICT',
        'People still report to this person. Move their reports to another manager first.',
        [{ path: field, issue: 'This person has active reports' }],
      );
    }
  }

  /** Refuses a code or phone number another user in the tenant already has. */
  private async checkUnique(
    tx: TenantTx,
    tenantId: string,
    id: string | null,
    code: string | null,
    phone: string | null,
  ): Promise<void> {
    const clashes: SQL[] = [];
    if (code !== null) clashes.push(eq(users.code, code));
    if (phone !== null) clashes.push(eq(users.phoneE164, phone));
    if (clashes.length === 0) return;
    const taken = await tx
      .select({ code: users.code, phone: users.phoneE164 })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), or(...clashes), id ? ne(users.id, id) : undefined));
    const details = [
      ...(code !== null && taken.some((user) => user.code === code)
        ? [{ path: 'code', issue: 'Another user has this code' }]
        : []),
      ...(phone !== null && taken.some((user) => user.phone === phone)
        ? [{ path: 'phone', issue: 'Another user has this mobile number' }]
        : []),
    ];
    if (details.length > 0) {
      throw new AppError('CONFLICT', 'Another user already has these details.', details);
    }
  }

  /** Runs an insert or update, turning a unique clash that slipped past the checks into CONFLICT. */
  private async write(statement: () => Promise<unknown>): Promise<void> {
    try {
      await statement();
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === 'users_tenant_code' || constraint === 'users_tenant_phone') {
        const path = constraint === 'users_tenant_code' ? 'code' : 'phone';
        throw new AppError('CONFLICT', 'Another user already has these details.', [
          { path, issue: 'Already used by another user' },
        ]);
      }
      throw error;
    }
  }

  private async lock(tx: TenantTx, tenantId: string, id: string): Promise<UserRow> {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .for('update');
    if (!user) throw notFound();
    return user;
  }

  private async read(tx: TenantTx, tenantId: string, id: string): Promise<UserResult> {
    const [row] = await this.query(tx).where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
    if (!row) throw notFound();
    const [user] = await this.results(tx, tenantId, [row]);
    return user!;
  }

  /** "Today" on the tenant's calendar, for attachments. */
  private async today(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone);
  }

  /** Rows as results, with each user's territories today. */
  private async results(
    tx: TenantTx,
    tenantId: string,
    rows: readonly SelectedUser[],
  ): Promise<UserResult[]> {
    if (rows.length === 0) return [];
    const attached = await this.territories.attachmentsOf(
      tx,
      tenantId,
      rows.map((row) => row.id),
      await this.today(tx, tenantId),
    );
    return rows.map((row) => toResult(row, attached.get(row.id) ?? []));
  }

  /** Results with the phone each user is bound to, if any: the one bound last and not reset. */
  private async views(
    tx: TenantTx,
    tenantId: string,
    results: readonly UserResult[],
  ): Promise<UserView[]> {
    if (results.length === 0) return [];
    const bound = await tx
      .selectDistinctOn([devices.userId], {
        userId: devices.userId,
        id: devices.id,
        platform: devices.platform,
        model: devices.model,
        osVersion: devices.osVersion,
        appVersion: devices.appVersion,
        boundAt: devices.boundAt,
        lastSeenAt: devices.lastSeenAt,
        health: devices.health,
      })
      .from(devices)
      .where(
        and(
          eq(devices.tenantId, tenantId),
          inArray(
            devices.userId,
            results.map((user) => user.id),
          ),
          isNull(devices.revokedAt),
        ),
      )
      .orderBy(devices.userId, desc(devices.boundAt));
    const byUser = new Map(
      bound.map(({ userId, boundAt, lastSeenAt, health, ...device }): [string, DeviceSummary] => [
        userId,
        {
          ...device,
          boundAt: boundAt?.toISOString() ?? null,
          lastSeenAt: lastSeenAt?.toISOString() ?? null,
          health: (health as DeviceHealth | null) ?? null,
        },
      ]),
    );
    return results.map((user) => ({ ...user, device: byUser.get(user.id) ?? null }));
  }

  private query(tx: TenantTx) {
    return tx
      .select(selection)
      .from(users)
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
      .leftJoin(
        managers,
        and(eq(managers.tenantId, users.tenantId), eq(managers.id, users.managerId)),
      )
      .$dynamic();
  }

  /** A number in E.164; one without a country code takes the tenant's default country (M1). */
  private async phone(tx: TenantTx, tenantId: string, raw: string): Promise<string> {
    const { defaultCountry } = await this.config.settings(tx, tenantId);
    return parsePhone(raw, defaultCountry);
  }

  private async designation(tx: TenantTx, tenantId: string, key: string) {
    const [designation] = await tx
      .select({
        id: designations.id,
        defaultRoleId: designations.defaultRoleId,
        canHaveReports: designations.canHaveReports,
      })
      .from(designations)
      .where(and(eq(designations.tenantId, tenantId), eq(designations.key, key)));
    if (!designation) throw invalid('designation', `There is no designation \`${key}\``);
    return designation;
  }

  private async roleByKey(tx: TenantTx, tenantId: string, key: string): Promise<RoleRef> {
    const role = await this.role(tx, and(eq(roles.tenantId, tenantId), eq(roles.key, key))!);
    if (!role) throw invalid('role', `There is no role \`${key}\``);
    return role;
  }

  private async roleById(tx: TenantTx, tenantId: string, id: string): Promise<RoleRef> {
    const role = await this.role(tx, and(eq(roles.tenantId, tenantId), eq(roles.id, id))!);
    if (!role) throw new Error(`Role ${id} is missing in tenant ${tenantId}.`);
    return role;
  }

  private async role(tx: TenantTx, where: SQL): Promise<RoleRef | undefined> {
    const [role] = await tx
      .select({ id: roles.id, key: roles.key, scope: roles.scope, permissions: roles.permissions })
      .from(roles)
      .where(where);
    return role && { ...role, permissions: role.permissions as TenantPermission[] };
  }
}

function checkDates(joiningDate: string | null, exitDate: string | null): void {
  if (joiningDate && exitDate && exitDate < joiningDate) {
    throw invalid('exitDate', 'The exit date is before the joining date');
  }
}
