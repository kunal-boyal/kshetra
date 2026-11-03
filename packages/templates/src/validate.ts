import { checkFields, checkForm, type FormContext } from '@thelamp/forms';
import { additive, checkMetrics, checkScore, computed } from '@thelamp/metrics';
import {
  dashboardLayoutIssues,
  type ErrorDetail,
  issueAt,
  RETIRED_PERMISSIONS,
  RETIRED_REQUEST_TYPES,
} from '@thelamp/shared';
import { checkAccountTypes } from './schema/account-types';
import { checkCatalogue } from './schema/catalogue';
import { checkImports } from './schema/imports';
import { checkDesignations, checkRoles, repeatedKeys } from './schema/organisation';
import { checkPeople } from './schema/people';
import { type Template, TemplateSchema } from './schema/template';
import { checkWorkflows } from './schema/workflows';

export type ValidationResult =
  { ok: true; template: Template } | { ok: false; issues: ErrorDetail[] };

/**
 * Checks a parsed template beyond its shape: unique keys, every reference resolves, and settings
 * agree with each other and with the business rules.
 */
/** Home layouts (D122): each for a role the template has, naming its metrics and levels. */
function checkDashboards(template: Template): ErrorDetail[] {
  const roles = new Set(template.roles.map((role) => role.key));
  const byKey = new Map(template.metrics.map((metric) => [metric.key, metric]));
  const metrics = template.metrics.map((metric) => ({
    key: metric.key,
    available: computed(metric, byKey),
    additive: additive(metric),
  }));
  const levels = template.geographyLevels.map((level) => level.key);
  return Object.entries(template.dashboards ?? {}).flatMap(([role, cards]) =>
    roles.has(role)
      ? dashboardLayoutIssues(cards, metrics, levels).map((found) => ({
          ...found,
          path: `dashboards.${role}${found.path.slice('cards'.length)}`,
        }))
      : [issueAt(['dashboards', role], `There is no role ${role}`)],
  );
}

export function checkTemplate(template: Template): ErrorDetail[] {
  const roles = new Set(template.roles.map((role) => role.key));
  const designations = new Set(template.designations.map((designation) => designation.key));
  const formContext: FormContext = {
    accountTypes: new Map(template.accountTypes.map((type) => [type.key, type])),
    roles,
    designations,
  };

  return [
    ...checkRoles(template.roles, ['roles']),
    ...checkDesignations(template.designations, roles, ['designations']),
    ...repeatedKeys(template.geographyLevels, ['geographyLevels'], 'Level'),
    ...checkFields(template.userFields, { accountTypes: new Map(), linkedAccountTypes: [] }, [
      'userFields',
    ]),
    ...checkAccountTypes(template.accountTypes, designations, ['accountTypes']),
    ...repeatedKeys(template.forms, ['forms'], 'Form'),
    ...template.forms.flatMap((form, index) => checkForm(form, formContext, ['forms', index])),
    ...checkMetrics(
      template.metrics,
      {
        forms: new Map(template.forms.map((form) => [form.key, form])),
        accountTypes: new Map(
          template.accountTypes.map((type) => [
            type.key,
            { segments: new Set(type.segmentRules.map((rule) => rule.segment)) },
          ]),
        ),
        roles,
      },
      ['metrics'],
    ),
    ...checkScore(template.score, new Map(template.metrics.map((metric) => [metric.key, metric])), [
      'score',
    ]),
    ...checkWorkflows(
      template.workflows,
      {
        roles,
        designations,
        slots: new Set(template.accountTypes.flatMap((type) => type.slots.map((slot) => slot.key))),
      },
      ['workflows'],
    ),
    ...checkPeople(template.people, designations, ['people']),
    ...checkDashboards(template),
    ...(template.catalogue ? checkCatalogue(template.catalogue, ['catalogue']) : []),
    ...checkImports(
      template.imports,
      {
        userFields: template.userFields.map((field) => field.key),
        accountTypes: new Map(
          template.accountTypes.map((type) => [
            type.key,
            {
              slots: type.slots.map((slot) => slot.key),
              fields: type.fields.map((field) => field.key),
            },
          ]),
        ),
        itemFields: template.catalogue?.itemFields.map((field) => field.key) ?? [],
      },
      ['imports'],
    ),
  ];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A file as if what was taken out since it was written weren't in it (decision D137): a role's
 * retired permissions, and a chain for a retired request type. Anything else is left for the
 * schema to judge.
 */
export function withoutRetired(input: unknown): unknown {
  if (!isObject(input)) return input;
  const file = { ...input };
  if (Array.isArray(file.roles)) {
    file.roles = file.roles.map((role: unknown) =>
      isObject(role) && Array.isArray(role.permissions)
        ? {
            ...role,
            permissions: role.permissions.filter(
              (permission: unknown) => !RETIRED_PERMISSIONS.includes(permission as string),
            ),
          }
        : role,
    );
  }
  if (isObject(file.workflows) && Array.isArray(file.workflows.definitions)) {
    file.workflows = {
      ...file.workflows,
      definitions: file.workflows.definitions.filter(
        (definition: unknown) =>
          !isObject(definition) ||
          !RETIRED_REQUEST_TYPES.includes(definition.requestType as string),
      ),
    };
  }
  return file;
}

/** Parses and checks a template, and returns it with defaults filled in, or every issue found. */
export function validateTemplate(input: unknown): ValidationResult {
  const parsed = TemplateSchema.safeParse(withoutRetired(input));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issueAt(issue.path, issue.message)),
    };
  }
  const issues = checkTemplate(parsed.data);
  return issues.length === 0 ? { ok: true, template: parsed.data } : { ok: false, issues };
}
