import { checkFields, checkForm, type FormContext } from '@kshetra/forms';
import { checkMetrics, checkScore } from '@kshetra/metrics';
import { type ErrorDetail, issueAt } from '@kshetra/shared';
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

/** Parses and checks a template, and returns it with defaults filled in, or every issue found. */
export function validateTemplate(input: unknown): ValidationResult {
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issueAt(issue.path, issue.message)),
    };
  }
  const issues = checkTemplate(parsed.data);
  return issues.length === 0 ? { ok: true, template: parsed.data } : { ok: false, issues };
}
