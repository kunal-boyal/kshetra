import { Injectable } from '@nestjs/common';
import type { FormDefinition, FormView } from '@thelamp/forms';
import {
  AppError,
  type ConfigurationChange,
  type ConfigurationPlan,
  type ErrorDetail,
  issueAt,
  newId,
  PortableSettings,
  todayIn,
  type UpdateDesignationBody,
  type UpdateRoleBody,
} from '@thelamp/shared';
import { loadTemplate, type Template, TemplateError, validateTemplate } from '@thelamp/templates';
import type { Access } from '../../platform/auth';
import { AuditLog, userActor } from '../../platform/audit';
import { canonicalJson } from '../../platform/canonical-json';
import type { TenantTx } from '../../platform/database';
import { TenantDirectory } from '../../platform/planes';
import { AccountTypesService } from '../accounts/account-types.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { AttendanceService } from '../field/attendance.service';
import { FormsService } from '../forms/forms.service';
import { DesignationsService } from '../iam/designations.service';
import { RolesService } from '../iam/roles.service';
import { UserFieldsService } from '../iam/user-fields.service';
import { ImportsService } from '../imports/imports.service';
import { templateImports } from '../imports/template-imports';
import { MetricsService } from '../metrics/metrics.service';
import { MetricsAdmin } from '../performance/metrics-admin';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { ChainsService } from '../workflow/chains.service';
import { HeldConfiguration, type HeldSections } from './held-configuration';

type Section = ConfigurationChange['section'];
type Change = ConfigurationChange['change'];

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** A form's definition, without what the apps hold beside it. */
function definitionOf(form: FormView): FormDefinition {
  const definition: Partial<FormView> = { ...form };
  delete definition.id;
  delete definition.version;
  delete definition.active;
  return definition as FormDefinition;
}

/** What differs between two records, field by field, for an update body. */
function differing<T extends object>(current: T, next: T, fields: readonly (keyof T)[]) {
  return Object.fromEntries(
    fields.flatMap((field) => (same(current[field], next[field]) ? [] : [[field, next[field]]])),
  ) as Partial<T>;
}

/**
 * A service's problems at their paths in the configuration file: `from` (such as `definition`)
 * is the part of a path that names the entry, and becomes `at` (such as `forms[3]`).
 */
function located(error: AppError, at: string, from = ''): ErrorDetail[] {
  const details = error.details ?? [];
  if (details.length === 0) return [{ path: at, issue: error.message }];
  return details.map(({ path, issue }) => {
    if (from && (path === from || path.startsWith(`${from}.`) || path.startsWith(`${from}[`))) {
      return { path: `${at}${path.slice(from.length)}`, issue };
    }
    return { path: from || !path ? at : `${at}.${path}`, issue };
  });
}

/**
 * Configuration export and import (M2, decision D66). A tenant's configuration goes out as an
 * industry template, so one format serves templates, copies between environments and new
 * tenants. An import adds and updates, never removes: missing entries are added, changed ones
 * updated or published as their next version, each through the module that owns it and its own
 * rules, so a key keeps its type, a metric its unit and a level its place. Every problem is
 * collected at its path in the file, and nothing is kept unless there are none.
 */
@Injectable()
export class ConfigurationService {
  constructor(
    private readonly directory: TenantDirectory,
    private readonly config: TenantConfigService,
    private readonly roles: RolesService,
    private readonly designations: DesignationsService,
    private readonly userFields: UserFieldsService,
    private readonly territories: TerritoriesService,
    private readonly accountTypes: AccountTypesService,
    private readonly catalogue: CatalogueService,
    private readonly forms: FormsService,
    private readonly metrics: MetricsService,
    private readonly metricsAdmin: MetricsAdmin,
    private readonly attendance: AttendanceService,
    private readonly imports: ImportsService,
    private readonly held: HeldConfiguration,
    private readonly chains: ChainsService,
    private readonly audit: AuditLog,
  ) {}

  /** The sections no module uses yet: as last kept, or from the starting template. */
  private async heldSections(tx: TenantTx, tenantId: string): Promise<HeldSections | undefined> {
    const kept = await this.held.get(tx, tenantId);
    if (kept) return kept;
    const started = await this.directory.template(tenantId);
    if (!started) return undefined;
    try {
      const template = loadTemplate(started.key);
      return { people: template.people };
    } catch (error) {
      if (error instanceof TemplateError) return undefined;
      throw error;
    }
  }

  /** The tenant's configuration as an industry template (spec 5.14), checked as one. */
  async export(tx: TenantTx, access: Access): Promise<Template> {
    const { tenantId } = access;
    const name = (await this.directory.displayName(tenantId)) ?? 'Tenant';
    const started = (await this.directory.template(tenantId)) ?? { key: 'custom', version: 1 };
    const settings = await this.config.settings(tx, tenantId);
    const held = await this.heldSections(tx, tenantId);
    const entries = await this.metrics.entries(tx, tenantId);
    const catalogue = await this.catalogue.section(tx, tenantId);
    const aliases = await this.imports.templateAliases(tx, tenantId);
    const accounts = Object.fromEntries(
      Object.entries(aliases).flatMap(([target, value]) =>
        target.startsWith('accounts:') ? [[target.slice('accounts:'.length), value]] : [],
      ),
    );
    const today = todayIn(settings.timezone);
    const file = {
      key: started.key,
      version: started.version,
      name: { en: name, hi: name },
      description: {
        en: `The configuration of ${name}, exported on ${today}.`,
        hi: `${name} का कॉन्फ़िगरेशन, ${today} को निर्यात किया गया।`,
      },
      terminology: await this.config.terminology(tx, tenantId),
      roles: (await this.roles.list(tx, tenantId)).map(
        ({ key, name, scope, permissions, mobileOnly }) => ({
          key,
          name,
          scope,
          permissions,
          mobileOnly,
        }),
      ),
      designations: (await this.designations.list(tx, tenantId)).map(
        ({ key, name, level, defaultRole, canHaveReports, ranked }) => ({
          key,
          name,
          level,
          defaultRole,
          canHaveReports,
          ranked,
        }),
      ),
      geographyLevels: (await this.territories.levels(tx, tenantId)).map(({ key, name }) => ({
        key,
        name,
      })),
      userFields: (await this.userFields.get(tx, tenantId)).fields,
      accountTypes: (await this.accountTypes.list(tx, tenantId)).map((type) => ({
        ...type.definition,
        active: type.active,
      })),
      forms: (await this.forms.list(tx, tenantId)).map(definitionOf),
      metrics: entries.filter((entry) => entry.active).map((entry) => entry.definition),
      score: await this.metrics.score(tx, tenantId),
      workflows: await this.chains.export(tx, tenantId),
      people: held
        ? { ...held.people, attendance: await this.attendance.rule(tx, tenantId) }
        : undefined,
      // A tenant whose template had no catalogue keeps the product's defaults, which have no
      // reasons to reject an order yet; a template leaves the section out for those.
      ...(catalogue && catalogue.rejectionReasons.length > 0 ? { catalogue } : {}),
      imports: {
        ...(aliases.users ? { users: aliases.users } : {}),
        ...(aliases.items ? { items: aliases.items } : {}),
        ...(Object.keys(accounts).length > 0 ? { accounts } : {}),
      },
      settings: PortableSettings.parse(
        Object.fromEntries(
          Object.keys(PortableSettings.shape).map((key) => [
            key,
            settings[key as keyof typeof settings],
          ]),
        ),
      ),
    };
    const checked = validateTemplate(file);
    if (!checked.ok) {
      throw new AppError(
        'VALIDATION',
        'The configuration has problems a template may not have; fix them before exporting.',
        checked.issues,
      );
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'configuration.exported',
      target: { type: 'tenant', id: tenantId },
    });
    return checked.template;
  }

  /**
   * Applies a configuration file, entry by entry, and says what it did. Problems are collected,
   * not thrown, so the caller decides: a preview rolls everything back, an import keeps it only
   * when there are none.
   */
  async apply(tx: TenantTx, access: Access, input: unknown): Promise<ConfigurationPlan> {
    const checked = validateTemplate(input);
    if (!checked.ok) return { changes: [], issues: checked.issues };
    const file = checked.template;
    const { tenantId } = access;
    const actor = userActor(access);
    const changes: ConfigurationChange[] = [];
    const issues: ErrorDetail[] = [];
    const step = async (
      section: Section,
      key: string,
      at: string,
      from: string,
      run: () => Promise<Change>,
    ) => {
      try {
        changes.push({ section, key, change: await run() });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        issues.push(...located(error, at, from));
      }
    };

    if (file.settings) {
      const settings = file.settings;
      await step('settings', 'settings', 'settings', '', async () => {
        const current = await this.config.settings(tx, tenantId);
        const patch = differing(
          current,
          { ...current, ...settings },
          Object.keys(settings) as never,
        );
        if (Object.keys(patch).length === 0) return 'same';
        await this.config.updateSettings(tx, tenantId, actor, patch);
        return 'update';
      });
    }

    await step('terminology', 'terminology', 'terminology', '', async () => {
      const current = await this.config.terminology(tx, tenantId);
      const next = { ...current, ...file.terminology };
      if (same(current, next)) return 'same';
      await this.config.replaceTerminology(tx, tenantId, actor, next);
      return 'update';
    });

    const roles = new Map((await this.roles.list(tx, tenantId)).map((role) => [role.key, role]));
    for (const [index, role] of file.roles.entries()) {
      await step('roles', role.key, `roles[${index}]`, '', async () => {
        const current = roles.get(role.key);
        if (!current) {
          await this.roles.create(tx, tenantId, access, role);
          return 'add';
        }
        const sorted = (list: readonly string[]) => [...list].sort();
        const body = differing(
          { ...current, permissions: sorted(current.permissions) },
          { ...current, ...role, permissions: sorted(role.permissions) },
          ['name', 'scope', 'permissions', 'mobileOnly'],
        ) as UpdateRoleBody;
        if (Object.keys(body).length === 0) return 'same';
        // The tenant admin holds everything, and nobody changes the role they hold.
        if (current.key === 'tenant_admin' || current.id === access.roleId) return 'kept';
        await this.roles.update(tx, access, current.id, body);
        return 'update';
      });
    }

    const designations = new Map(
      (await this.designations.list(tx, tenantId)).map((designation) => [
        designation.key,
        designation,
      ]),
    );
    for (const [index, designation] of file.designations.entries()) {
      await step('designations', designation.key, `designations[${index}]`, '', async () => {
        const current = designations.get(designation.key);
        if (!current) {
          await this.designations.create(tx, tenantId, access, designation);
          return 'add';
        }
        const body = differing(current, { ...current, ...designation }, [
          'name',
          'level',
          'defaultRole',
          'canHaveReports',
          'ranked',
        ]) as UpdateDesignationBody;
        if (Object.keys(body).length === 0) return 'same';
        await this.designations.update(tx, access, current.id, body);
        return 'update';
      });
    }

    await this.importLevels(tx, access, file, changes, issues);
    await this.importUserFields(tx, access, file, changes, issues);

    const types = new Map(
      (await this.accountTypes.list(tx, tenantId)).map((type) => [type.key, type]),
    );
    for (const [index, type] of file.accountTypes.entries()) {
      await step('accountTypes', type.key, `accountTypes[${index}]`, 'definition', async () => {
        const current = types.get(type.key);
        if (!current) {
          await this.accountTypes.create(tx, tenantId, actor, access.userId, newId(), type);
          return 'add';
        }
        if (same({ ...current.definition, active: current.active }, type)) return 'same';
        await this.accountTypes.publish(tx, tenantId, actor, access.userId, current.id, type);
        return 'update';
      });
    }

    if (file.catalogue) {
      const catalogue = file.catalogue;
      await step('catalogue', 'catalogue', 'catalogue', 'catalogue', () =>
        this.catalogue.importSection(tx, tenantId, catalogue),
      );
    }

    const forms = new Map((await this.forms.list(tx, tenantId)).map((form) => [form.key, form]));
    for (const [index, form] of file.forms.entries()) {
      await step('forms', form.key, `forms[${index}]`, 'definition', async () => {
        const current = forms.get(form.key);
        if (!current) {
          await this.forms.create(tx, access, form);
          return 'add';
        }
        if (same(definitionOf(current), form)) return 'same';
        await this.forms.publish(tx, access, current.id, form as FormDefinition);
        return 'update';
      });
    }

    const { timezone } = await this.config.settings(tx, tenantId);
    const entries = new Map(
      (await this.metrics.entries(tx, tenantId)).map((entry) => [entry.definition.key, entry]),
    );
    for (const [index, metric] of file.metrics.entries()) {
      await step('metrics', metric.key, `metrics[${index}]`, 'definition', async () => {
        const current = entries.get(metric.key);
        if (!current) {
          await this.metricsAdmin.create(tx, tenantId, actor, access.userId, metric);
          return 'add';
        }
        if (current.active && same(current.definition, metric)) return 'same';
        await this.metricsAdmin.update(tx, tenantId, actor, access.userId, metric.key, {
          definition: metric,
          active: true,
          from: todayIn(timezone),
        });
        return 'update';
      });
    }

    await step('score', 'score', 'score', 'definition', async () => {
      if (same(await this.metrics.score(tx, tenantId), file.score)) return 'same';
      await this.metricsAdmin.updateScore(tx, tenantId, actor, access.userId, file.score);
      return 'update';
    });

    await step('attendance', 'attendance', 'people.attendance', '', async () => {
      if (same(await this.attendance.rule(tx, tenantId), file.people.attendance)) return 'same';
      await this.attendance.setRule(tx, tenantId, file.people.attendance);
      return 'update';
    });

    for (const [target, settings] of Object.entries(templateImports(file))) {
      await step('imports', target, 'imports', '', () =>
        this.imports.importAliases(tx, tenantId, target, settings),
      );
    }

    const chains = await this.chains.import(tx, access, file.workflows);
    changes.push(...chains.changes);
    issues.push(...chains.issues);

    const held = await this.heldSections(tx, tenantId);
    const next: HeldSections = { people: file.people };
    changes.push({
      section: 'people',
      key: 'people',
      change: same(held?.people, next.people) ? 'same' : held ? 'update' : 'add',
    });
    if (!held || !same(held, next)) await this.held.save(tx, tenantId, next, access.userId);

    if (issues.length === 0) {
      await this.config.touch(tx, tenantId, access.userId);
      await this.audit.record(tx, tenantId, actor, {
        action: 'configuration.imported',
        target: { type: 'tenant', id: tenantId },
        after: {
          template: { key: file.key, version: file.version },
          changes: changes.filter(
            (change) => change.change === 'add' || change.change === 'update',
          ),
        },
      });
    }
    return { changes, issues };
  }

  /** Levels by place: renamed where the file renames them, added below; none taken away. */
  private async importLevels(
    tx: TenantTx,
    access: Access,
    file: Template,
    changes: ConfigurationChange[],
    issues: ErrorDetail[],
  ): Promise<void> {
    const current = await this.territories.levels(tx, access.tenantId);
    const next = Array.from({ length: Math.max(current.length, file.geographyLevels.length) }).map(
      (_, index) => file.geographyLevels[index] ?? current[index]!,
    );
    const found = next.map((level, index): ConfigurationChange => {
      const before = current[index];
      return {
        section: 'geographyLevels',
        key: level.key,
        change: !before
          ? 'add'
          : same({ key: before.key, name: before.name }, level)
            ? 'same'
            : 'update',
      };
    });
    if (found.some((change) => change.change !== 'same')) {
      try {
        await this.territories.updateLevels(
          tx,
          access.tenantId,
          userActor(access),
          access.userId,
          next,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        issues.push(...located(error, 'geographyLevels', 'levels'));
        return;
      }
    }
    changes.push(...found);
  }

  /** Fields by key: changed where the file changes them, added after; none retired. */
  private async importUserFields(
    tx: TenantTx,
    access: Access,
    file: Template,
    changes: ConfigurationChange[],
    issues: ErrorDetail[],
  ): Promise<void> {
    const current = await this.userFields.get(tx, access.tenantId);
    const known = new Map(
      [...current.retired, ...current.fields].map((field) => [field.key, field.type]),
    );
    const retyped = file.userFields.flatMap((field, index) => {
      const type = known.get(field.key);
      return type && type !== field.type
        ? [
            issueAt(
              ['userFields', index, 'type'],
              `\`${field.key}\` was a ${type} field, and a key keeps its type`,
            ),
          ]
        : [];
    });
    if (retyped.length > 0) {
      issues.push(...retyped);
      return;
    }
    const byKey = new Map(file.userFields.map((field) => [field.key, field]));
    const next = [
      ...current.fields.map((field) => byKey.get(field.key) ?? field),
      ...file.userFields.filter((field) => !current.fields.some((mine) => mine.key === field.key)),
    ];
    const found = file.userFields.map((field): ConfigurationChange => {
      const mine = current.fields.find((entry) => entry.key === field.key);
      return {
        section: 'userFields',
        key: field.key,
        change: !mine ? 'add' : same(mine, field) ? 'same' : 'update',
      };
    });
    if (found.some((change) => change.change !== 'same')) {
      try {
        await this.userFields.replace(tx, access.tenantId, access, { fields: next });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        issues.push(...located(error, 'userFields'));
        return;
      }
    }
    changes.push(...found);
  }
}

/** Thrown to roll a preview back; it carries what the import would do. */
export class PreviewRollback extends Error {
  constructor(readonly plan: ConfigurationPlan) {
    super('Preview rolled back');
  }
}

/** The problems of a plan, thrown so the import's transaction rolls back. */
export function planRefused(plan: ConfigurationPlan): AppError {
  return new AppError(
    'VALIDATION',
    'The configuration file has problems; nothing was imported.',
    plan.issues,
  );
}
