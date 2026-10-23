import { Injectable } from '@nestjs/common';
import type { AccountType, AccountTypeView, CustomField } from '@thelamp/forms';
import { AppError, type ErrorDetail, issueAt, newId } from '@thelamp/shared';
import { checkAccountTypes } from '@thelamp/templates';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  accounts,
  accountSlots,
  accountTypes,
  accountTypeVersions,
} from '../../db/schema/accounts';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { notFound } from '../iam/actor';
import { DesignationsService } from '../iam/designations.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** A type with the definition of its current version. */
export interface TypeRecord {
  id: string;
  key: string;
  active: boolean;
  version: number;
  definition: AccountType;
}

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/**
 * Account types (spec 5.5) and their versions. A template's types become version 1 at
 * provisioning; each change publishes the next version, and the config bundle carries the
 * current one, so a change moves the config version.
 */
@Injectable()
export class AccountTypesService {
  constructor(
    private readonly audit: AuditLog,
    private readonly config: TenantConfigService,
    private readonly designations: DesignationsService,
  ) {}

  async applyTemplate(tx: TenantTx, tenantId: string, types: readonly AccountType[]) {
    for (const definition of types) {
      const id = newId();
      await tx.insert(accountTypes).values({
        id,
        tenantId,
        key: definition.key,
        currentVersion: 1,
        active: definition.active,
      });
      await tx
        .insert(accountTypeVersions)
        .values({ tenantId, accountTypeId: id, version: 1, definition });
    }
  }

  async list(tx: TenantTx, tenantId: string): Promise<TypeRecord[]> {
    return tx
      .select({
        id: accountTypes.id,
        key: accountTypes.key,
        active: accountTypes.active,
        version: accountTypes.currentVersion,
        definition: accountTypeVersions.definition,
      })
      .from(accountTypes)
      .innerJoin(
        accountTypeVersions,
        and(
          eq(accountTypeVersions.tenantId, accountTypes.tenantId),
          eq(accountTypeVersions.accountTypeId, accountTypes.id),
          eq(accountTypeVersions.version, accountTypes.currentVersion),
        ),
      )
      .where(eq(accountTypes.tenantId, tenantId))
      .orderBy(asc(accountTypes.key));
  }

  /** As the apps hold them: the definition, with the type's own switch. */
  views(records: readonly TypeRecord[]): AccountTypeView[] {
    return records.map((record) => ({
      ...record.definition,
      active: record.active,
      id: record.id,
      version: record.version,
    }));
  }

  async byKey(tx: TenantTx, tenantId: string, key: string): Promise<TypeRecord | undefined> {
    return (await this.list(tx, tenantId)).find((type) => type.key === key);
  }

  async byId(tx: TenantTx, tenantId: string, id: string): Promise<TypeRecord> {
    const found = (await this.list(tx, tenantId)).find((type) => type.id === id);
    if (!found) throw notFound();
    return found;
  }

  /**
   * The next code of a type that numbers its accounts, such as `R00042`. The counter row is
   * locked until the transaction ends, so two accounts never share a number.
   */
  async nextCode(tx: TenantTx, tenantId: string, type: TypeRecord): Promise<string> {
    if (type.definition.code.mode !== 'auto') throw new Error(`${type.key} takes typed codes.`);
    const [row] = await tx
      .update(accountTypes)
      .set({ nextNumber: sql`${accountTypes.nextNumber} + 1` })
      .where(and(eq(accountTypes.tenantId, tenantId), eq(accountTypes.id, type.id)))
      .returning({ number: sql<number>`${accountTypes.nextNumber} - 1` });
    return `${type.definition.code.prefix}${String(row!.number).padStart(5, '0')}`;
  }

  /**
   * A new type at version 1 (M2): its key unused by any type, and the definition checked against
   * the tenant's designations and its other types, as a template's are.
   */
  async create(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    actorId: string | null,
    id: string,
    definition: AccountType,
  ): Promise<AccountTypeView> {
    const types = await this.list(tx, tenantId);
    if (types.some((type) => type.key === definition.key)) {
      throw invalid([
        issueAt(['definition', 'key'], `There is a type \`${definition.key}\` already`),
      ]);
    }
    const issues: ErrorDetail[] = [];
    const designations = new Set(
      (await this.designations.list(tx, tenantId)).map((designation) => designation.key),
    );
    const all = [...types.map((type) => type.definition), definition];
    const index = all.length - 1;
    issues.push(
      ...checkAccountTypes(all, designations, ['types']).flatMap((issue) =>
        issue.path.startsWith(`types[${index}]`)
          ? [{ ...issue, path: issue.path.replace(`types[${index}]`, 'definition') }]
          : [],
      ),
    );
    if (issues.length > 0) throw invalid(issues);
    await tx.insert(accountTypes).values({
      id,
      tenantId,
      key: definition.key,
      currentVersion: 1,
      active: definition.active,
      createdBy: actorId,
      updatedBy: actorId,
    });
    await tx
      .insert(accountTypeVersions)
      .values({ tenantId, accountTypeId: id, version: 1, definition, publishedBy: actorId });
    await this.config.touch(tx, tenantId, actorId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'account_type.created',
      target: { type: 'account_type', id },
      after: { version: 1, definition },
    });
    const [view] = this.views([
      { id, key: definition.key, active: definition.active, version: 1, definition },
    ]);
    return view!;
  }

  /**
   * Publishes the next version of a type. Its key never changes; a field keeps its type once any
   * version has used it, so stored values keep their meaning; a slot someone fills can't go.
   */
  async publish(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    actorId: string | null,
    id: string,
    definition: AccountType,
  ): Promise<AccountTypeView> {
    const types = await this.list(tx, tenantId);
    const current = types.find((type) => type.id === id);
    if (!current) throw notFound();
    const issues: ErrorDetail[] = [];
    if (definition.key !== current.key) {
      issues.push(issueAt(['definition', 'key'], 'A type keeps its key'));
    }
    const designations = new Set(
      (await this.designations.list(tx, tenantId)).map((designation) => designation.key),
    );
    const all = types.map((type) => (type.id === id ? definition : type.definition));
    const index = types.findIndex((type) => type.id === id);
    issues.push(
      ...checkAccountTypes(all, designations, ['types']).flatMap((issue) =>
        issue.path.startsWith(`types[${index}]`)
          ? [{ ...issue, path: issue.path.replace(`types[${index}]`, 'definition') }]
          : [],
      ),
    );
    const earlier = await this.earlierFields(tx, tenantId, id);
    definition.fields.forEach((field, position) => {
      const before = earlier.get(field.key);
      if (before && before.type !== field.type) {
        issues.push(
          issueAt(
            ['definition', 'fields', position, 'type'],
            `\`${field.key}\` was a ${before.type} field, and a key keeps its type`,
          ),
        );
      }
    });
    const kept = new Set(definition.slots.map((slot) => slot.key));
    for (const slot of current.definition.slots.filter((entry) => !kept.has(entry.key))) {
      if (await this.slotInUse(tx, tenantId, id, slot.key)) {
        issues.push(issueAt(['definition', 'slots'], `Empty the \`${slot.key}\` slot first`));
      }
    }
    if (issues.length > 0) throw invalid(issues);
    const version = current.version + 1;
    await tx
      .insert(accountTypeVersions)
      .values({ tenantId, accountTypeId: id, version, definition, publishedBy: actorId });
    await tx
      .update(accountTypes)
      .set({
        currentVersion: version,
        active: definition.active,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(accountTypes.tenantId, tenantId), eq(accountTypes.id, id)));
    await this.config.touch(tx, tenantId, actorId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'account_type.published',
      target: { type: 'account_type', id },
      before: { version: current.version, definition: current.definition },
      after: { version, definition },
    });
    const [view] = this.views([{ ...current, active: definition.active, version, definition }]);
    return view!;
  }

  /** Every field any version of a type has had, by key, latest first. */
  private async earlierFields(tx: TenantTx, tenantId: string, id: string) {
    const versions = await tx
      .select({ definition: accountTypeVersions.definition })
      .from(accountTypeVersions)
      .where(
        and(eq(accountTypeVersions.tenantId, tenantId), eq(accountTypeVersions.accountTypeId, id)),
      )
      .orderBy(asc(accountTypeVersions.version));
    const fields = new Map<string, CustomField>();
    for (const { definition } of versions) {
      for (const field of definition.fields) fields.set(field.key, field);
    }
    return fields;
  }

  private async slotInUse(tx: TenantTx, tenantId: string, typeId: string, slotKey: string) {
    const [row] = await tx
      .select({ id: accountSlots.accountId })
      .from(accountSlots)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, accountSlots.tenantId), eq(accounts.id, accountSlots.accountId)),
      )
      .where(
        and(
          eq(accountSlots.tenantId, tenantId),
          eq(accounts.typeId, typeId),
          eq(accountSlots.slotKey, slotKey),
          isNull(accountSlots.validTo),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
