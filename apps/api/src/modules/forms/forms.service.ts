import { Injectable } from '@nestjs/common';
import {
  type AnyField,
  checkForm,
  type FormContext,
  type FormDefinition,
  type FormView,
} from '@kshetra/forms';
import { AppError, type ErrorDetail, issueAt, newId } from '@kshetra/shared';
import { and, asc, eq } from 'drizzle-orm';
import { forms, formVersions } from '../../db/schema/forms';
import { type AuditActor, AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
import { notFound } from '../iam/actor';
import { DesignationsService } from '../iam/designations.service';
import { People } from '../iam/people';
import { RolesService } from '../iam/roles.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/** Every field of a form, those inside repeating groups included, by key. */
function flatten(fields: readonly AnyField[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const field of fields) {
    types.set(field.key, field.type);
    if (field.type === 'repeating_group') {
      for (const [key, type] of flatten(field.fields)) types.set(key, type);
    }
  }
  return types;
}

/**
 * Forms (spec 5.6). A template's forms become version 1 at provisioning; every publish adds the
 * next version, and the config bundle carries the current one of each form in use, filtered to
 * those the caller may fill, so a change moves the config version.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly audit: AuditLog,
    private readonly config: TenantConfigService,
    private readonly accountTypes: AccountTypesService,
    private readonly roles: RolesService,
    private readonly designations: DesignationsService,
    private readonly people: People,
  ) {}

  async applyTemplate(tx: TenantTx, tenantId: string, definitions: readonly FormDefinition[]) {
    for (const definition of definitions) {
      const id = newId();
      await tx.insert(forms).values({ id, tenantId, key: definition.key, currentVersion: 1 });
      await tx.insert(formVersions).values({ tenantId, formId: id, version: 1, definition });
    }
  }

  async list(tx: TenantTx, tenantId: string): Promise<FormView[]> {
    const rows = await tx
      .select({
        id: forms.id,
        active: forms.active,
        version: forms.currentVersion,
        definition: formVersions.definition,
      })
      .from(forms)
      .innerJoin(
        formVersions,
        and(
          eq(formVersions.tenantId, forms.tenantId),
          eq(formVersions.formId, forms.id),
          eq(formVersions.version, forms.currentVersion),
        ),
      )
      .where(eq(forms.tenantId, tenantId))
      .orderBy(asc(forms.key));
    return rows.map(({ definition, ...row }) => ({ ...definition, ...row }));
  }

  /** The forms in use that the caller may fill: everyone's, or their role's or designation's. */
  async forCaller(tx: TenantTx, access: Access): Promise<FormView[]> {
    const me = (await this.people.facts(tx, access.tenantId, [access.userId])).get(access.userId);
    return (await this.list(tx, access.tenantId)).filter(
      (form) =>
        form.active &&
        (!form.audience ||
          (form.audience.roles.length === 0 && form.audience.designations.length === 0) ||
          form.audience.roles.includes(access.roleKey) ||
          (me !== undefined && form.audience.designations.includes(me.designation))),
    );
  }

  /** What a form may refer to: the tenant's account types, roles and designations. */
  private async context(tx: TenantTx, tenantId: string): Promise<FormContext> {
    return {
      accountTypes: new Map(
        (await this.accountTypes.list(tx, tenantId)).map((type) => [
          type.key,
          { contacts: type.definition.contacts },
        ]),
      ),
      roles: new Set((await this.roles.list(tx, tenantId)).map((role) => role.key)),
      designations: new Set(
        (await this.designations.list(tx, tenantId)).map((designation) => designation.key),
      ),
    };
  }

  async create(tx: TenantTx, access: Access, definition: FormDefinition): Promise<FormView> {
    const tenantId = access.tenantId;
    const issues = checkForm(definition, await this.context(tx, tenantId), ['definition']);
    if ((await this.list(tx, tenantId)).some((form) => form.key === definition.key)) {
      throw new AppError('CONFLICT', 'Another form has this key.', [
        { path: 'definition.key', issue: 'Another form has this key' },
      ]);
    }
    if (issues.length > 0) throw invalid(issues);
    const id = newId();
    await tx.insert(forms).values({
      id,
      tenantId,
      key: definition.key,
      currentVersion: 1,
      createdBy: access.userId,
      updatedBy: access.userId,
    });
    await tx
      .insert(formVersions)
      .values({ tenantId, formId: id, version: 1, definition, publishedBy: access.userId });
    await this.published(tx, access, id, null, { version: 1, definition });
    return { ...definition, id, version: 1, active: true };
  }

  /**
   * Publishes the next version of a form. Its key never changes, and a field keeps its type once
   * any version used it, so every submission reads as it was entered.
   */
  async publish(
    tx: TenantTx,
    access: Access,
    id: string,
    definition: FormDefinition,
  ): Promise<FormView> {
    const tenantId = access.tenantId;
    const current = (await this.list(tx, tenantId)).find((form) => form.id === id);
    if (!current) throw notFound();
    const issues = checkForm(definition, await this.context(tx, tenantId), ['definition']);
    if (definition.key !== current.key) {
      issues.push(issueAt(['definition', 'key'], 'A form keeps its key'));
    }
    const earlier = await this.earlierFields(tx, tenantId, id);
    for (const [key, type] of flatten(definition.fields)) {
      const before = earlier.get(key);
      if (before && before !== type) {
        issues.push(
          issueAt(
            ['definition', 'fields'],
            `\`${key}\` was a ${before} field, and a key keeps its type`,
          ),
        );
      }
    }
    if (issues.length > 0) throw invalid(issues);
    const version = current.version + 1;
    await tx
      .insert(formVersions)
      .values({ tenantId, formId: id, version, definition, publishedBy: access.userId });
    await tx
      .update(forms)
      .set({ currentVersion: version, updatedAt: new Date(), updatedBy: access.userId })
      .where(and(eq(forms.tenantId, tenantId), eq(forms.id, id)));
    await this.published(tx, access, id, current, { version, definition });
    return { ...definition, id, version, active: current.active };
  }

  /** Switches a form off or on; its versions and submissions stay. */
  async setActive(tx: TenantTx, access: Access, id: string, active: boolean): Promise<FormView> {
    const tenantId = access.tenantId;
    const current = (await this.list(tx, tenantId)).find((form) => form.id === id);
    if (!current) throw notFound();
    if (current.active !== active) {
      await tx
        .update(forms)
        .set({ active, updatedAt: new Date(), updatedBy: access.userId })
        .where(and(eq(forms.tenantId, tenantId), eq(forms.id, id)));
      await this.config.touch(tx, tenantId, access.userId);
      await this.audit.record(tx, tenantId, userActor(access), {
        action: 'form.updated',
        target: { type: 'form', id },
        before: { active: current.active },
        after: { active },
      });
    }
    return { ...current, active };
  }

  private async published(
    tx: TenantTx,
    access: Access,
    id: string,
    before: FormView | null,
    after: { version: number; definition: FormDefinition },
  ): Promise<void> {
    const actor: AuditActor = userActor(access);
    await this.config.touch(tx, access.tenantId, access.userId);
    await this.audit.record(tx, access.tenantId, actor, {
      action: 'form.published',
      target: { type: 'form', id },
      before: before ? { version: before.version } : null,
      after,
    });
  }

  /** Every field any version of a form has had, with its type, by key. */
  private async earlierFields(tx: TenantTx, tenantId: string, id: string) {
    const versions = await tx
      .select({ definition: formVersions.definition })
      .from(formVersions)
      .where(and(eq(formVersions.tenantId, tenantId), eq(formVersions.formId, id)))
      .orderBy(asc(formVersions.version));
    const types = new Map<string, string>();
    for (const { definition } of versions) {
      for (const [key, type] of flatten(definition.fields)) types.set(key, type);
    }
    return types;
  }
}
