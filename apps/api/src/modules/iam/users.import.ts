import { Injectable, type OnModuleInit } from '@nestjs/common';
import { checkValueChanges } from '@thelamp/forms';
import {
  AppError,
  canGrant,
  type CreateUserBody,
  type ImportProblem,
  matchName,
  normaliseMobile,
  NUMBER_IN_USE,
  todayIn,
  type UpdateUserBody,
  UserCode,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { designations as designationsTable, roles as rolesTable, users } from '../../db/schema/iam';
import type { TenantTx } from '../../platform/database';
import { MembershipSync } from '../../platform/planes';
import { cellDate, cellText, customValues, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
} from '../imports/targets';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { DesignationsService } from './designations.service';
import { RolesService } from './roles.service';
import { UserFieldsService } from './user-fields.service';
import { UsersService } from './users.service';

const Email = z.email().max(254);
const TOP = { kind: 'top' } as const;

/** Who a row reports to: nobody, someone by code or name, or as before (column left out). */
type ManagerRef = typeof TOP | { kind: 'code'; code: string } | { kind: 'name'; name: string };

interface Entry {
  row: number;
  code: string;
  name: string;
  /** Undefined when the column is left out: an update keeps what is there. */
  phone: string | null | undefined;
  email: string | null | undefined;
  designation: string;
  role: string | undefined;
  manager: ManagerRef | undefined;
  /** The manager's code once resolved; null for the top; undefined to keep as before. */
  managerCode: string | null | undefined;
  territoryIds: string[] | undefined;
  joiningDate: string | null | undefined;
  custom: Record<string, unknown>;
  existing: Existing | undefined;
}

interface Existing {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  status: 'active' | 'inactive';
  managerId: string | null;
  designation: string;
  role: string;
  custom: Record<string, unknown>;
}

const lower = (text: string) => text.toLowerCase();

/**
 * User imports (Appendix B.1, M3, M19). The employee code is the upsert key. "Reports to" takes a
 * code, or a name matched by BR-42; blank or "-" means the top. Nothing is guessed, no row may
 * make a reporting loop, and an existing admin keeps the admin role. The commit writes every row
 * through the same rules as the people screens, managers before their reports, or none.
 */
@Injectable()
export class UsersImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'users';
  readonly permission = 'user.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly users: UsersService,
    private readonly designations: DesignationsService,
    private readonly roles: RolesService,
    private readonly userFields: UserFieldsService,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    private readonly members: MembershipSync,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(tx: TenantTx, tenantId: string): Promise<TargetField[]> {
    const { fields } = await this.userFields.get(tx, tenantId);
    return [
      { key: 'code', names: ['Employee code', 'Code', 'Emp code'], required: true },
      { key: 'name', names: ['Name', 'Employee name', 'Full name'], required: true },
      { key: 'mobile', names: ['Mobile', 'Mobile number', 'Phone'], required: false },
      { key: 'email', names: ['Email', 'E-mail'], required: false },
      { key: 'designation', names: ['Designation'], required: true },
      { key: 'role', names: ['Role'], required: false },
      { key: 'reports_to', names: ['Reports to', 'Manager', 'Reporting manager'], required: false },
      {
        key: 'territory_codes',
        names: ['Territory codes', 'Territories', 'Territory'],
        required: false,
      },
      { key: 'joining_date', names: ['Joining date', 'Date of joining'], required: false },
      ...fields.map((field) => ({
        key: `custom.${field.key}`,
        names: [field.label.en, field.label.hi, field.key],
        required: false,
        label: field.label,
      })),
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const tenantId = access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) => isEmptyCell(cell, emptyValues);

    const settings = await this.config.settings(tx, tenantId);
    const today = todayIn(settings.timezone);
    const designations = await this.designations.list(tx, tenantId);
    const roles = await this.roles.list(tx, tenantId);
    const { fields } = await this.userFields.get(tx, tenantId);
    const territories = await this.territories.list(tx, tenantId, { active: true });
    const territoryByCode = new Map(territories.map((node) => [lower(node.code), node.id]));
    const existingRows: Existing[] = await tx
      .select({
        id: users.id,
        code: users.code,
        name: users.name,
        phone: users.phoneE164,
        status: users.status,
        managerId: users.managerId,
        designation: designationsTable.key,
        role: rolesTable.key,
        custom: users.custom,
      })
      .from(users)
      .innerJoin(
        designationsTable,
        and(
          eq(designationsTable.tenantId, users.tenantId),
          eq(designationsTable.id, users.designationId),
        ),
      )
      .innerJoin(
        rolesTable,
        and(eq(rolesTable.tenantId, users.tenantId), eq(rolesTable.id, users.roleId)),
      )
      .where(eq(users.tenantId, tenantId));
    const existingByCode = new Map(existingRows.map((user) => [lower(user.code), user]));
    const existingById = new Map(existingRows.map((user) => [user.id, user]));

    const designationOf = (text: string) =>
      designations.find(
        (entry) =>
          entry.key === lower(text) ||
          [entry.name.en.one, entry.name.en.other, entry.name.hi.one, entry.name.hi.other].some(
            (name) => lower(name) === lower(text),
          ),
      );
    const roleOf = (text: string) =>
      roles.find(
        (entry) =>
          entry.key === lower(text) ||
          [entry.name.en, entry.name.hi].some((name) => lower(name) === lower(text)),
      );

    const codes = new Map<string, number[]>();
    for (const { row, cells } of rows) {
      const code = lower(cellText(cells.code));
      if (code) codes.set(code, [...(codes.get(code) ?? []), row]);
    }
    const phones = new Map<string, number[]>();

    const entries: Entry[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.code);
      if (!code) problem(row, 'code', 'Fill in the employee code');
      else if (!UserCode.safeParse(code).success) {
        problem(row, 'code', 'Use up to 40 letters, digits, dots, dashes, slashes or underscores');
      } else if ((codes.get(lower(code))?.length ?? 0) > 1) {
        problem(
          row,
          'code',
          `This code appears more than once, in rows ${codes.get(lower(code))!.join(', ')}`,
        );
      }
      const name = cellText(cells.name);
      if (name.length < 2 || name.length > 100) problem(row, 'name', 'Use 2 to 100 characters');

      let phone: string | null | undefined;
      if ('mobile' in cells) {
        if (empty(cells.mobile)) phone = null;
        else {
          phone = normaliseMobile(
            cellText(cells.mobile).replace(/[\s-]/g, ''),
            settings.defaultCountry,
          );
          if (!phone)
            problem(row, 'mobile', 'Use a 10-digit mobile number starting with 6, 7, 8 or 9');
          else phones.set(phone, [...(phones.get(phone) ?? []), row]);
        }
      }
      let email: string | null | undefined;
      if ('email' in cells) {
        email = empty(cells.email) ? null : lower(cellText(cells.email));
        if (email && !Email.safeParse(email).success)
          problem(row, 'email', 'Not a valid email address');
      }
      const designation = designationOf(cellText(cells.designation));
      if (!designation) {
        problem(
          row,
          'designation',
          cellText(cells.designation)
            ? `There is no designation called ${cellText(cells.designation)}`
            : 'Fill in the designation',
        );
      }
      let role: string | undefined;
      if ('role' in cells && !empty(cells.role)) {
        const found = roleOf(cellText(cells.role));
        if (!found) problem(row, 'role', `There is no role called ${cellText(cells.role)}`);
        else if (!canGrant(access, found)) problem(row, 'role', 'You cannot give this role');
        else role = found.key;
      }
      let manager: ManagerRef | undefined;
      if ('reports_to' in cells) {
        // Appendix B.1: blank or "-" means the top level, whatever else the tenant counts as empty.
        if (empty(cells.reports_to) || cellText(cells.reports_to) === '-') manager = TOP;
        else {
          const text = cellText(cells.reports_to);
          manager =
            codes.has(lower(text)) || existingByCode.has(lower(text))
              ? { kind: 'code', code: text }
              : { kind: 'name', name: text };
        }
      }
      let territoryIds: string[] | undefined;
      if ('territory_codes' in cells && !empty(cells.territory_codes)) {
        territoryIds = [];
        for (const part of cellText(cells.territory_codes).split(/[,;]/)) {
          const territoryCode = part.trim();
          if (!territoryCode) continue;
          const id = territoryByCode.get(lower(territoryCode));
          if (!id)
            problem(
              row,
              'territory_codes',
              `There is no active territory with the code ${territoryCode}`,
            );
          else territoryIds.push(id);
        }
      }
      let joiningDate: string | null | undefined;
      if ('joining_date' in cells) {
        joiningDate = empty(cells.joining_date) ? null : cellDate(cells.joining_date);
        if (joiningDate === null && !empty(cells.joining_date)) {
          problem(row, 'joining_date', 'Write a date such as 2026-04-01 or 01-04-2026');
        }
      }
      const custom = customValues(fields, cells, emptyValues);
      const existing = existingByCode.get(lower(code));
      const checked = checkValueChanges(
        fields,
        today,
        existing ? existing.custom : null,
        existing
          ? custom
          : Object.fromEntries(Object.entries(custom).filter(([, value]) => value !== null)),
      );
      for (const issue of checked.issues) problem(row, issue.path, issue.issue);

      entries.push({
        row,
        code,
        name,
        phone,
        email,
        designation: designation?.key ?? '',
        // An existing admin keeps the admin role (Appendix B.1).
        role: existing?.role === 'tenant_admin' ? undefined : role,
        manager,
        managerCode: undefined,
        territoryIds,
        joiningDate,
        custom,
        existing,
      });
    }

    // A number new to this organisation may already sign in to another (decision D103).
    const elsewhere = await this.members.activeElsewhere(
      [...phones.keys()].filter((phone) => !existingRows.some((user) => user.phone === phone)),
      tenantId,
    );
    for (const [phone, at] of phones) {
      if (elsewhere.has(phone)) for (const row of at) problem(row, 'mobile', NUMBER_IN_USE);
      if (at.length > 1)
        for (const row of at)
          problem(row, 'mobile', `This number appears in rows ${at.join(', ')}`);
      const owner = existingRows.find((user) => user.phone === phone);
      for (const row of at) {
        const entry = entries.find((candidate) => candidate.row === row);
        if (owner && lower(owner.code) !== lower(entry?.code ?? '')) {
          problem(row, 'mobile', `Another person, ${owner.code}, has this number`);
        }
      }
    }

    // Reports to: a code in the file or the tenant, or a name only one person fits (BR-42).
    const byCode = new Map(entries.map((entry) => [lower(entry.code), entry]));
    const people = [
      ...entries.map((entry) => ({ code: entry.code, name: entry.name })),
      ...existingRows
        .filter((user) => user.status === 'active' && !byCode.has(lower(user.code)))
        .map((user) => ({ code: user.code, name: user.name })),
    ];
    for (const entry of entries) {
      const ref = entry.manager;
      if (!ref) continue;
      if (ref.kind === 'top') entry.managerCode = null;
      else if (ref.kind === 'code') entry.managerCode = ref.code;
      else {
        const found = matchName(
          ref.name,
          people.filter((person) => lower(person.code) !== lower(entry.code)),
        );
        if (found.status === 'matched') entry.managerCode = found.candidate.code;
        else if (found.status === 'ambiguous') {
          problem(
            entry.row,
            'reports_to',
            `${ref.name} could be ${found.candidates.map((person) => `${person.name} (${person.code})`).join(' or ')}; write the code`,
          );
        } else problem(entry.row, 'reports_to', `There is nobody called ${ref.name}`);
      }
      if (entry.managerCode && lower(entry.managerCode) === lower(entry.code)) {
        problem(entry.row, 'reports_to', 'A person cannot report to themselves');
        entry.managerCode = undefined;
      }
    }

    // The tree afterwards: no loops, and every manager able to have reports.
    const managerOf = (code: string): string | null => {
      const entry = byCode.get(lower(code));
      if (entry && entry.managerCode !== undefined) return entry.managerCode;
      const user = entry?.existing ?? existingByCode.get(lower(code));
      const id = user?.managerId;
      return id ? (existingById.get(id)?.code ?? null) : null;
    };
    for (const entry of entries) {
      if (!entry.managerCode) continue;
      const seen = new Set([lower(entry.code)]);
      for (let next = entry.managerCode as string | null; next; next = managerOf(next)) {
        if (seen.has(lower(next))) {
          problem(entry.row, 'reports_to', 'This would make a reporting loop');
          break;
        }
        seen.add(lower(next));
      }
      const manager = byCode.get(lower(entry.managerCode));
      const managerDesignation = manager
        ? manager.designation
        : existingByCode.get(lower(entry.managerCode))?.designation;
      const managerUser = existingByCode.get(lower(entry.managerCode));
      if (!manager && managerUser?.status !== 'active') {
        problem(entry.row, 'reports_to', `${entry.managerCode} is not active`);
      } else if (
        managerDesignation &&
        !designations.find((designation) => designation.key === managerDesignation)?.canHaveReports
      ) {
        problem(entry.row, 'reports_to', `${entry.managerCode}'s designation cannot have reports`);
      }
    }
    return { problems, entries, today };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, entries } = await this.plan(tx, rows, context);
    return checked(
      problems,
      entries.map((entry) => ({ existing: entry.existing !== undefined })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, entries, today } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    const tenantId = access.tenantId;
    // Everyone's ID by code, kept up to date as the file adds people.
    const ids = new Map(
      (
        await tx
          .select({ id: users.id, code: users.code })
          .from(users)
          .where(eq(users.tenantId, tenantId))
      ).map((user) => [lower(user.code), user.id]),
    );
    const lookup = (code: string): string => {
      const id = ids.get(lower(code));
      if (!id) throw new AppError('NOT_FOUND', `There is nobody with the code ${code}.`);
      return id;
    };

    // Managers in the file come before their reports.
    const inFile = new Map(entries.map((entry) => [lower(entry.code), entry]));
    const depth = (entry: Entry, seen = new Set<string>()): number => {
      const manager = entry.managerCode ? inFile.get(lower(entry.managerCode)) : undefined;
      if (!manager || seen.has(lower(manager.code))) return 0;
      seen.add(lower(entry.code));
      return 1 + depth(manager, seen);
    };
    const ordered = [...entries].sort((a, b) => depth(a) - depth(b));

    let created = 0;
    let updated = 0;
    for (const entry of ordered) {
      try {
        const managerId =
          entry.managerCode === undefined
            ? undefined
            : entry.managerCode === null
              ? null
              : lookup(entry.managerCode);
        if (entry.existing) {
          const changes: Record<string, unknown> = {
            name: entry.name,
            designation: entry.designation,
            ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
            ...(entry.email !== undefined ? { email: entry.email } : {}),
            ...(entry.role !== undefined ? { role: entry.role } : {}),
            ...(managerId !== undefined ? { managerId } : {}),
            ...(entry.joiningDate !== undefined ? { joiningDate: entry.joiningDate } : {}),
            ...(Object.keys(entry.custom).length > 0 ? { custom: entry.custom } : {}),
          };
          const before = await this.users.get(tx, access, entry.existing.id);
          const after = await this.users.update(
            tx,
            tenantId,
            access,
            entry.existing.id,
            changes as UpdateUserBody,
          );
          if (entry.territoryIds) {
            await this.territories.replaceAttachments(
              tx,
              tenantId,
              entry.existing.id,
              entry.territoryIds,
              today,
            );
          }
          // The phone isn't part of a change; JSON leaves an undefined field out.
          if (
            JSON.stringify({ ...before, device: undefined }) !== JSON.stringify(after) ||
            (entry.territoryIds &&
              JSON.stringify(before.territories.map((territory) => territory.id).sort()) !==
                JSON.stringify([...entry.territoryIds].sort()))
          ) {
            updated += 1;
          }
        } else {
          const input: CreateUserBody = {
            code: entry.code,
            name: entry.name,
            designation: entry.designation,
            managerId: managerId ?? null,
            territoryIds: entry.territoryIds ?? [],
            custom: Object.fromEntries(
              Object.entries(entry.custom).filter(([, value]) => value !== null),
            ),
            ...(entry.phone ? { phone: entry.phone } : {}),
            ...(entry.email ? { email: entry.email } : {}),
            ...(entry.role ? { role: entry.role } : {}),
            ...(entry.joiningDate ? { joiningDate: entry.joiningDate } : {}),
          };
          const user = await this.users.create(tx, tenantId, access, input);
          ids.set(lower(entry.code), user.id);
          created += 1;
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        throw new ImportRefused([
          {
            row: entry.row,
            field: error.details?.[0]?.path ?? null,
            issue: error.details?.[0]?.issue ?? error.message,
          },
        ]);
      }
    }
    return { created, updated };
  }
}
