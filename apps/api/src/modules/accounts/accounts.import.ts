import { Injectable, type OnModuleInit } from '@nestjs/common';
import { checkValueChanges } from '@thelamp/forms';
import {
  AccountCode,
  type AccountAddress,
  AppError,
  type GeoPoint,
  type ImportProblem,
  type ImportTarget,
  matchName,
  newId,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { accounts, accountTypes } from '../../db/schema/accounts';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { People, type PersonFacts } from '../iam/people';
import { cellText, cellYesNo, customValues, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
} from '../imports/targets';
import { TerritoriesService } from '../territories/territories.service';
import { AccountTypesService, type TypeRecord } from './account-types.service';
import { AccountsService } from './accounts.service';

interface Planned {
  row: number;
  /** The existing account with this code, if any. */
  id: string | null;
  code: string;
  name: string;
  territoryId: string;
  parentCode: string | null;
  address?: AccountAddress;
  location?: GeoPoint;
  geofenceRadiusM?: number | null;
  /** Who fills each slot whose column the file has; null empties it. */
  slots: Record<string, string | null>;
  custom: Record<string, unknown>;
  active?: boolean;
}

const lower = (text: string) => text.trim().toLowerCase();
const number = (text: string) => (/^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : null);

/**
 * Account imports (M4, M19, Appendix B.2), one type at a time: `accounts:<type key>`. The code is
 * the key: a code already in use updates that account. Slots take an employee code or a name
 * matched by BR-42 among the people whose designation fits the slot; an unclear name, like an
 * unknown parent, fails the whole file.
 */
@Injectable()
export class AccountsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'accounts';
  readonly permission = 'account.import';

  constructor(
    private readonly targets: ImportTargets,
    private readonly types: AccountTypesService,
    private readonly accounts: AccountsService,
    private readonly territories: TerritoriesService,
    private readonly people: People,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  private async type(tx: TenantTx, tenantId: string, target: ImportTarget): Promise<TypeRecord> {
    const key = target.slice('accounts:'.length);
    const type = await this.types.byKey(tx, tenantId, key);
    if (!type) throw new AppError('VALIDATION', 'There is no such type of account to import.');
    return type;
  }

  async fields(tx: TenantTx, tenantId: string, target: ImportTarget): Promise<TargetField[]> {
    const type = await this.type(tx, tenantId, target);
    const { definition } = type;
    return [
      { key: 'code', names: ['Account code', 'Code'], required: true },
      { key: 'name', names: ['Name', 'Account name'], required: true },
      { key: 'territory_code', names: ['Territory code', 'Territory'], required: true },
      {
        key: 'parent_code',
        names: ['Parent account code', 'Parent code', 'Parent'],
        required: false,
      },
      ...definition.slots.map((slot) => ({
        key: `slot.${slot.key}`,
        names: [slot.name.en, slot.name.hi, slot.key],
        required: false,
        label: slot.name,
      })),
      { key: 'latitude', names: ['Latitude', 'Lat'], required: false },
      { key: 'longitude', names: ['Longitude', 'Long', 'Lng'], required: false },
      {
        key: 'geofence_radius_m',
        names: ['Geofence radius (m)', 'Geofence radius', 'Radius'],
        required: false,
      },
      { key: 'address', names: ['Address'], required: false },
      { key: 'city', names: ['City'], required: false },
      { key: 'state', names: ['State'], required: false },
      { key: 'pin', names: ['PIN', 'Pin code', 'PIN code', 'Pincode'], required: false },
      ...definition.fields.map((field) => ({
        key: `custom.${field.key}`,
        names: [field.label.en, field.label.hi, field.key],
        required: false,
        label: field.label,
      })),
      { key: 'active', names: ['Active', 'Status'], required: false },
    ];
  }

  /** Every row's intent, with every problem found without writing. */
  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const tenantId = context.access.tenantId;
    const type = await this.type(tx, tenantId, context.target);
    const { definition } = type;
    const today = await this.accounts.today(tx, tenantId);
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      isEmptyCell(cell, context.emptyValues);

    const existing = new Map(
      (
        await tx
          .select({
            id: accounts.id,
            code: accounts.code,
            typeKey: accountTypes.key,
            custom: accounts.custom,
            status: accounts.status,
          })
          .from(accounts)
          .innerJoin(
            accountTypes,
            and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
          )
          .where(eq(accounts.tenantId, tenantId))
      ).map((account) => [lower(account.code), account]),
    );
    const territories = new Map(
      (await this.territories.list(tx, tenantId, {})).map((node) => [lower(node.code), node]),
    );
    const everyone = await this.people.everyone(tx, tenantId);
    const byCode = new Map(everyone.map((person) => [lower(person.code), person]));

    const seen = new Map<string, number[]>();
    for (const { row, cells } of rows) {
      const code = lower(cellText(cells.code));
      if (code) seen.set(code, [...(seen.get(code) ?? []), row]);
    }

    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.code);
      const name = cellText(cells.name);
      const current = existing.get(lower(code));
      if (!code) problem(row, 'code', 'Fill in the account code');
      else if (!AccountCode.safeParse(code).success) {
        problem(row, 'code', 'Use up to 40 letters, digits, dots, dashes, slashes or underscores');
      } else if ((seen.get(lower(code))?.length ?? 0) > 1) {
        problem(
          row,
          'code',
          `This code appears more than once, in rows ${seen.get(lower(code))!.join(', ')}`,
        );
      } else if (current && current.typeKey !== type.key) {
        problem(row, 'code', 'Another type of account has this code');
      } else if (current?.status === 'pending') {
        problem(row, 'code', 'This account waits for approval');
      }
      if (!name) problem(row, 'name', 'Fill in the name');
      else if (name.length > 200) problem(row, 'name', 'Use at most 200 characters');

      const territory = territories.get(lower(cellText(cells.territory_code)));
      if (empty(cells.territory_code)) problem(row, 'territory_code', 'Fill in the territory code');
      else if (!territory) {
        problem(
          row,
          'territory_code',
          `There is no territory with the code ${cellText(cells.territory_code)}`,
        );
      } else if (!territory.active)
        problem(row, 'territory_code', 'This territory is switched off');

      const parentCode =
        'parent_code' in cells && !empty(cells.parent_code) ? cellText(cells.parent_code) : null;
      if (parentCode && lower(parentCode) === lower(code)) {
        problem(row, 'parent_code', 'An account cannot belong to itself');
      }

      // Slots: an employee code, else a name among those whose designation fits (BR-42).
      const slots: Record<string, string | null> = {};
      for (const slot of definition.slots) {
        const field = `slot.${slot.key}`;
        if (!(field in cells)) continue;
        if (empty(cells[field])) {
          slots[slot.key] = null;
          continue;
        }
        const text = cellText(cells[field]);
        const fits = (person: PersonFacts) =>
          person.status === 'active' && slot.designations.includes(person.designation);
        const coded = byCode.get(lower(text));
        if (coded) {
          if (coded.status !== 'active') problem(row, field, `${coded.code} is not active`);
          else if (!fits(coded))
            problem(row, field, `${coded.code}'s designation can't fill this slot`);
          else slots[slot.key] = coded.id;
          continue;
        }
        const match = matchName(text, everyone.filter(fits));
        if (match.status === 'matched') slots[slot.key] = match.candidate.id;
        else if (match.status === 'ambiguous') {
          problem(
            row,
            field,
            `${text} could be ${match.candidates
              .map((person) => `${person.name} (${person.code})`)
              .join(' or ')}; write the code`,
          );
        } else problem(row, field, `There is nobody called ${text} who can fill this slot`);
      }

      // A location: both coordinates or neither.
      let location: GeoPoint | undefined;
      const hasLat = 'latitude' in cells && !empty(cells.latitude);
      const hasLng = 'longitude' in cells && !empty(cells.longitude);
      if (hasLat !== hasLng) {
        problem(row, hasLat ? 'longitude' : 'latitude', 'Fill in both coordinates, or neither');
      } else if (hasLat) {
        const lat = number(cellText(cells.latitude));
        const lng = number(cellText(cells.longitude));
        if (lat === null || lat < -90 || lat > 90)
          problem(row, 'latitude', 'Write a latitude between -90 and 90');
        if (lng === null || lng < -180 || lng > 180)
          problem(row, 'longitude', 'Write a longitude between -180 and 180');
        if (lat !== null && lng !== null) location = { lat, lng };
      }
      let geofenceRadiusM: number | null | undefined;
      if ('geofence_radius_m' in cells) {
        if (empty(cells.geofence_radius_m)) geofenceRadiusM = null;
        else {
          const radius = number(cellText(cells.geofence_radius_m));
          if (radius === null || !Number.isInteger(radius) || radius < 50 || radius > 5000) {
            problem(row, 'geofence_radius_m', 'Write a whole number of metres from 50 to 5,000');
          } else geofenceRadiusM = radius;
        }
      }

      const addressParts = (['address', 'city', 'state', 'pin'] as const).filter(
        (key) => key in cells,
      );
      let address: AccountAddress | undefined;
      if (addressParts.length > 0) {
        address = {};
        const line = cellText(cells.address);
        if (line) address.line = line.slice(0, 300);
        if (cellText(cells.city)) address.city = cellText(cells.city).slice(0, 100);
        if (cellText(cells.state)) address.state = cellText(cells.state).slice(0, 100);
        const pin = cellText(cells.pin);
        if (pin && !/^\d{6}$/.test(pin)) problem(row, 'pin', 'Write the 6-digit PIN code');
        else if (pin) address.pin = pin;
      }

      const values = customValues(definition.fields, cells, context.emptyValues);
      const custom = checkValueChanges(
        definition.fields,
        today,
        current ? current.custom : null,
        current
          ? values
          : Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)),
      );
      for (const issue of custom.issues) problem(row, issue.path, issue.issue);

      let active: boolean | undefined;
      if ('active' in cells && !empty(cells.active)) {
        const yes = cellYesNo(cells.active);
        if (yes === null) problem(row, 'active', 'Write yes or no');
        else active = yes;
      }

      // An active account needs its required slots filled.
      const staysActive = active ?? (current ? current.status === 'active' : true);
      if (staysActive) {
        for (const slot of definition.slots.filter((entry) => entry.required)) {
          const field = `slot.${slot.key}`;
          const emptied = slots[slot.key] === null;
          const missing = !current && !(slot.key in slots);
          if ((emptied || missing) && !problems.some((p) => p.row === row && p.field === field)) {
            problem(row, field, 'Fill in this slot');
          }
        }
      }

      planned.push({
        row,
        id: current?.id ?? null,
        code,
        name,
        territoryId: territory?.id ?? '',
        parentCode,
        ...(address ? { address } : {}),
        ...(location ? { location } : {}),
        ...(geofenceRadiusM !== undefined ? { geofenceRadiusM } : {}),
        slots,
        custom: values,
        ...(active !== undefined ? { active } : {}),
      });
    }

    // Parents: an account already there, or one earlier in the order this file is written.
    const inFile = new Set(planned.map((entry) => lower(entry.code)));
    for (const entry of planned) {
      if (!entry.parentCode) continue;
      const parent = existing.get(lower(entry.parentCode));
      if (parent) {
        if (!definition.parentTypes.includes(parent.typeKey)) {
          problem(entry.row, 'parent_code', "This type of account can't belong to that one");
        }
      } else if (!(
        inFile.has(lower(entry.parentCode)) && definition.parentTypes.includes(type.key)
      )) {
        problem(entry.row, 'parent_code', `There is no account with the code ${entry.parentCode}`);
      }
    }
    return { problems, planned, type };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return (await this.plan(tx, rows, context)).problems;
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned, type } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const access: Access = context.access;
    const tenantId = access.tenantId;
    const ids = new Map(
      planned.flatMap((entry) => (entry.id ? [[lower(entry.code), entry.id]] : [])),
    );
    const codes = async (code: string) => {
      const known = ids.get(lower(code));
      if (known) return known;
      const [row] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code)));
      return row?.id;
    };
    let created = 0;
    let updated = 0;
    // Parents in the file go first, so every child finds its parent.
    const ordered = [...planned].sort(
      (a, b) =>
        Number(Boolean(a.parentCode && !ids.has(lower(a.parentCode)))) -
        Number(Boolean(b.parentCode && !ids.has(lower(b.parentCode)))),
    );
    for (const entry of ordered) {
      try {
        const parentId = entry.parentCode ? await codes(entry.parentCode) : undefined;
        if (!entry.id) {
          const id = newId();
          await this.accounts.create(
            tx,
            access,
            {
              id,
              type: type.key,
              code: entry.code,
              name: entry.name,
              territoryId: entry.territoryId,
              ...(parentId ? { parentId } : {}),
              ...(entry.address ? { address: entry.address } : {}),
              ...(entry.location ? { location: entry.location } : {}),
              ...(entry.geofenceRadiusM ? { geofenceRadiusM: entry.geofenceRadiusM } : {}),
              slots: Object.fromEntries(
                Object.entries(entry.slots).filter(
                  (pair): pair is [string, string] => pair[1] !== null,
                ),
              ),
              custom: Object.fromEntries(
                Object.entries(entry.custom).filter(([, value]) => value !== null),
              ),
            },
            { asImport: true, ...(entry.active === false ? { inactive: true } : {}) },
          );
          ids.set(lower(entry.code), id);
          created += 1;
        } else {
          const before = await this.accounts.get(tx, access, entry.id);
          const changes = changedSlots(before, entry.slots);
          const after = await this.accounts.update(tx, access, entry.id, {
            name: entry.name,
            territoryId: entry.territoryId,
            ...(entry.parentCode ? { parentId: parentId ?? null } : {}),
            ...(entry.address ? { address: entry.address } : {}),
            ...(entry.location ? { location: entry.location } : {}),
            ...(entry.geofenceRadiusM !== undefined
              ? { geofenceRadiusM: entry.geofenceRadiusM }
              : {}),
            ...(entry.active !== undefined ? { status: entry.active ? 'active' : 'inactive' } : {}),
            ...(Object.keys(changes).length > 0 ? { slots: { holders: changes } } : {}),
            custom: entry.custom,
          });
          if (differs(before, after)) updated += 1;
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

/** Only the slots whose holder the file changes, so an unchanged file changes nothing. */
function changedSlots(
  before: { slots: readonly { slot: string; user: { id: string } }[] },
  slots: Record<string, string | null>,
): Record<string, string | null> {
  const now = new Map(before.slots.map((holder) => [holder.slot, holder.user.id]));
  return Object.fromEntries(
    Object.entries(slots).filter(([slot, userId]) => (now.get(slot) ?? null) !== userId),
  );
}

/** Whether an update changed anything a person would see. */
function differs(before: object, after: object): boolean {
  const stamp = { updatedAt: undefined };
  return JSON.stringify({ ...before, ...stamp }) !== JSON.stringify({ ...after, ...stamp });
}
