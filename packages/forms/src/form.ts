import {
  type ErrorDetail,
  IconName,
  issueAt,
  Key,
  localizedText,
  LocalizedNoun,
  repeats,
  toMinorUnits,
} from '@thelamp/shared';
import { z } from 'zod';
import { checkCondition, Condition } from './conditions';
import { type AnyField, FormField, PHOTO_SOURCES } from './fields';
import { FORMULA_LIMITS, formulaFields, parseFormula } from './formula';
import { compilePattern, conditionHolds, type Values } from './values';

type Path = readonly PropertyKey[];

/**
 * What a visit form's conditions may ask besides its fields (decision D97): whether the visit took
 * an order, so a no-order reason can show only when none was taken. The key is reserved: no field
 * may use it.
 */
export const VISIT_ORDERED = 'visit_ordered';
const visitOrderedField: AnyField = {
  key: VISIT_ORDERED,
  type: 'yes_no',
  label: { en: 'The visit took an order', hi: 'विज़िट में ऑर्डर लिया गया' },
  required: false,
} as AnyField;

/** The facts a form's conditions see before its first field. */
function factsOf(form: Pick<FormDefinition, 'visitSession'>): Map<string, AnyField> {
  return form.visitSession ? new Map([[VISIT_ORDERED, visitOrderedField]]) : new Map();
}

/** Whether submissions link to an account, and to which account types (spec 5.6). */
export const AccountLink = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({
    mode: z.enum(['optional', 'required']),
    accountTypes: z.array(Key).min(1).max(20),
  }),
]);

/** One version of a form: what a field user records (spec 5.6). */
export const FormDefinition = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    description: localizedText(300).optional(),
    icon: IconName,
    tags: z.array(Key).max(10).default([]).meta({ description: 'Reporting tags' }),
    accountLink: AccountLink.default({ mode: 'none' }),
    visitSession: z.boolean().default(false).meta({
      description: 'Whether the form is filled inside a checked-in visit (module M6)',
    }),
    shift: z.enum(['required', 'allowed_off_shift']).default('required'),
    photos: z
      .strictObject({
        min: z.int().min(0).max(10).meta({ description: '0 makes photos optional' }),
        max: z.int().min(1).max(10),
        source: z.enum(PHOTO_SOURCES).default('camera'),
      })
      .optional()
      .meta({ description: 'Photos of the whole form. Leave out for none.' }),
    signature: z.enum(['none', 'optional', 'required']).default('none'),
    signatureRequiredWhen: Condition.optional().meta({
      description:
        'With an optional signature: when it is required, such as when samples are given (decision D97)',
    }),
    geofence: z.enum(['inherit', 'off', 'advisory', 'required']).default('inherit').meta({
      description:
        "Whether capture must happen inside the account's geofence; inherit follows the account type",
    }),
    review: z.enum(['manual', 'auto', 'none']).default('manual').meta({
      description:
        "Manual review, auto-approval under the tenant's rules, or no review (counts at once)",
    }),
    audience: z
      .strictObject({
        roles: z.array(Key).max(20).default([]),
        designations: z.array(Key).max(20).default([]),
      })
      .optional()
      .meta({ description: 'Who can use the form. Leave out for everyone who can submit forms.' }),
    fields: z.array(FormField).min(1).max(100),
  })
  .meta({ id: 'FormDefinition' });

export type AccountLink = z.output<typeof AccountLink>;
export type FormDefinition = z.output<typeof FormDefinition>;

/** What a form may refer to outside itself. */
export interface FormContext {
  /** Account types by key, with whether their accounts hold contacts. */
  accountTypes: ReadonlyMap<string, { contacts: boolean }>;
  roles: ReadonlySet<string>;
  designations: ReadonlySet<string>;
}

/** What the fields of one form, account type or record may refer to. */
export interface FieldContext {
  accountTypes: ReadonlyMap<string, { contacts: boolean }>;
  /** The account types the form links to, whose contacts a contact picker lists. */
  linkedAccountTypes: readonly string[];
}

function keyIssues(keys: readonly string[], path: Path, noun: string): ErrorDetail[] {
  return repeats(keys).map((index) =>
    issueAt([...path, index], `${noun} \`${keys[index]}\` appears more than once`),
  );
}

/** Problems with one field's own settings. */
function fieldIssues(field: AnyField, context: FieldContext, path: Path): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const range = (min: number | undefined, max: number | undefined, what: string) => {
    if (min !== undefined && max !== undefined && min > max) {
      issues.push(issueAt([...path], `The minimum ${what} is above the maximum`));
    }
  };
  switch (field.type) {
    case 'short_text':
      range(field.minLength, field.maxLength, 'length');
      if (field.pattern !== undefined && compilePattern(field.pattern) === null) {
        issues.push(
          issueAt(
            [...path, 'pattern'],
            'This pattern is not valid, or uses lookarounds or backreferences, which can be slow',
          ),
        );
      }
      break;
    case 'long_text':
      range(field.minLength, field.maxLength, 'length');
      break;
    case 'number':
      range(field.min, field.max, 'value');
      break;
    case 'currency':
      if (field.min !== undefined && field.max !== undefined) {
        if (toMinorUnits(field.min) > toMinorUnits(field.max)) {
          issues.push(issueAt([...path], 'The minimum amount is above the maximum'));
        }
      }
      break;
    case 'date':
      range(field.minDaysFromToday, field.maxDaysFromToday, 'date');
      break;
    case 'calculated':
      if (field.result === 'currency' && field.decimals !== 2) {
        issues.push(issueAt([...path, 'decimals'], 'An amount keeps 2 places'));
      }
      break;
    case 'single_select':
    case 'multi_select': {
      if ((field.options === undefined) === (field.optionsFrom === undefined)) {
        issues.push(issueAt([...path], 'Give either options or optionsFrom'));
      }
      const keys = (field.options ?? []).map((option) => option.key);
      issues.push(
        ...repeats(keys).map((index) =>
          issueAt(
            [...path, 'options', index, 'key'],
            `Option \`${keys[index]}\` appears more than once`,
          ),
        ),
      );
      if (field.type === 'multi_select') {
        range(field.minSelected, field.maxSelected, 'number of choices');
        if (field.options && (field.minSelected ?? 0) > field.options.length) {
          issues.push(issueAt([...path, 'minSelected'], 'This asks for more choices than exist'));
        }
      }
      break;
    }
    case 'account_picker':
      field.accountTypes.forEach((type, index) => {
        if (!context.accountTypes.has(type)) {
          issues.push(
            issueAt([...path, 'accountTypes', index], `There is no account type \`${type}\``),
          );
        }
      });
      issues.push(...keyIssues(field.accountTypes, [...path, 'accountTypes'], 'Account type'));
      break;
    case 'contact_picker': {
      const linked = context.linkedAccountTypes;
      const without = linked.filter((type) => context.accountTypes.get(type)?.contacts !== true);
      if (linked.length === 0) {
        issues.push(issueAt([...path], 'A contact picker needs the form to link to an account'));
      } else if (without.length > 0) {
        issues.push(
          issueAt(
            [...path],
            `Contacts are off for account type ${without.map((type) => `\`${type}\``).join(', ')}`,
          ),
        );
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

/** The fields a formula may read (decision D118): figures, by type. */
const FORMULA_SOURCES: readonly string[] = ['number', 'currency', 'calculated', 'product_lines'];

/**
 * A calculated field's formula (decision D118): it reads, and refers only to earlier number,
 * currency, quantity and calculated fields, at most `FORMULA_LIMITS.references` of them.
 */
function formulaIssues(
  field: Extract<AnyField, { type: 'calculated' }>,
  scope: ReadonlyMap<string, AnyField>,
  path: Path,
  unknown: (key: string) => string,
): ErrorDetail[] {
  const at = [...path, 'formula'];
  const parsed = parseFormula(field.formula);
  if ('problem' in parsed) {
    return [issueAt(at, `${parsed.problem.issue}, at character ${parsed.problem.at + 1}`)];
  }
  const issues: ErrorDetail[] = [];
  const keys = formulaFields(parsed.tree);
  if (keys.length > FORMULA_LIMITS.references) {
    issues.push(issueAt(at, `Use at most ${FORMULA_LIMITS.references} fields in one formula`));
  }
  for (const key of keys) {
    const source = scope.get(key);
    if (key === field.key) issues.push(issueAt(at, 'A formula can’t use its own field'));
    else if (!source) issues.push(issueAt(at, unknown(key)));
    else if (!FORMULA_SOURCES.includes(source.type)) {
      issues.push(
        issueAt(
          at,
          `\`${key}\` is a ${source.type} field; use number, currency, quantity or calculated fields`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Checks a list of fields: keys are unique, each field's settings make sense, and each visibility
 * condition refers to an earlier field. Inside a repeating group, a condition may also refer to
 * the fields before the group; fields outside never refer into a group.
 */
export function checkFields(
  fields: readonly AnyField[],
  context: FieldContext,
  path: Path,
  facts: ReadonlyMap<string, AnyField> = new Map(),
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const allKeys = new Set<string>();
  const groupOf = new Map<string, string>();
  for (const field of fields) {
    allKeys.add(field.key);
    if (field.type === 'repeating_group') {
      for (const item of field.fields) {
        allKeys.add(item.key);
        groupOf.set(item.key, field.key);
      }
    }
  }
  const unknown = (group: string | undefined) => (key: string) => {
    const owner = groupOf.get(key);
    if (owner !== undefined && owner !== group) {
      return `\`${key}\` is inside repeating group \`${owner}\``;
    }
    return allKeys.has(key)
      ? `\`${key}\` must come before this field`
      : `There is no field \`${key}\``;
  };

  const seen = new Set<string>();
  const visit = (field: AnyField, at: Path, scope: Map<string, AnyField>, group?: string) => {
    if (seen.has(field.key)) {
      issues.push(issueAt([...at, 'key'], `Field \`${field.key}\` appears more than once`));
    }
    if (field.key === VISIT_ORDERED) {
      issues.push(
        issueAt([...at, 'key'], `\`${VISIT_ORDERED}\` is kept for whether the visit took an order`),
      );
    }
    seen.add(field.key);
    issues.push(...fieldIssues(field, context, at));
    if (field.type === 'calculated')
      issues.push(...formulaIssues(field, scope, at, unknown(group)));
    if (field.visibleWhen) {
      issues.push(
        ...checkCondition(field.visibleWhen, scope, [...at, 'visibleWhen'], unknown(group)),
      );
    }
  };

  const scope = new Map<string, AnyField>(facts);
  fields.forEach((field, index) => {
    const at = [...path, index];
    visit(field, at, scope);
    if (field.type === 'repeating_group') {
      const inner = new Map(scope);
      field.fields.forEach((item, itemIndex) => {
        visit(item, [...at, 'fields', itemIndex], inner, field.key);
        inner.set(item.key, item);
      });
    }
    scope.set(field.key, field);
  });
  return issues;
}

/** Checks a form beyond its shape: references, settings that conflict, and its fields. */
export function checkForm(
  form: FormDefinition,
  context: FormContext,
  path: Path = [],
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const link = form.accountLink;
  const linked = link.mode === 'none' ? [] : link.accountTypes;
  linked.forEach((type, index) => {
    if (!context.accountTypes.has(type)) {
      issues.push(
        issueAt(
          [...path, 'accountLink', 'accountTypes', index],
          `There is no account type \`${type}\``,
        ),
      );
    }
  });
  issues.push(...keyIssues(linked, [...path, 'accountLink', 'accountTypes'], 'Account type'));
  if (form.visitSession && link.mode !== 'required') {
    issues.push(
      issueAt(
        [...path, 'visitSession'],
        'A form filled inside a visit needs a required account link',
      ),
    );
  }
  if (form.photos && form.photos.min > form.photos.max) {
    issues.push(issueAt([...path, 'photos'], 'The minimum number of photos is above the maximum'));
  }
  form.audience?.roles.forEach((role, index) => {
    if (!context.roles.has(role)) {
      issues.push(issueAt([...path, 'audience', 'roles', index], `There is no role \`${role}\``));
    }
  });
  form.audience?.designations.forEach((designation, index) => {
    if (!context.designations.has(designation)) {
      issues.push(
        issueAt(
          [...path, 'audience', 'designations', index],
          `There is no designation \`${designation}\``,
        ),
      );
    }
  });
  issues.push(...keyIssues(form.tags, [...path, 'tags'], 'Tag'));
  issues.push(
    ...checkFields(
      form.fields,
      { accountTypes: context.accountTypes, linkedAccountTypes: linked },
      [...path, 'fields'],
      factsOf(form),
    ),
  );
  if (form.signatureRequiredWhen) {
    if (form.signature !== 'optional') {
      issues.push(
        issueAt(
          [...path, 'signatureRequiredWhen'],
          'Only an optional signature is required by a condition',
        ),
      );
    }
    const scope = new Map(factsOf(form));
    for (const field of form.fields) scope.set(field.key, field);
    issues.push(
      ...checkCondition(
        form.signatureRequiredWhen,
        scope,
        [...path, 'signatureRequiredWhen'],
        (key) => `There is no field \`${key}\``,
      ),
    );
  }
  return issues;
}

/**
 * Whether a submission needs a signature (decision D97): always, never, or, for an optional one
 * with a condition, when the condition holds on the values and the visit's facts.
 */
export function signatureRequired(
  form: Pick<FormDefinition, 'signature' | 'signatureRequiredWhen'>,
  values: Values,
  facts: { visitOrdered?: boolean | undefined } = {},
): boolean {
  if (form.signature === 'required') return true;
  if (form.signature !== 'optional' || !form.signatureRequiredWhen) return false;
  return conditionHolds(form.signatureRequiredWhen, {
    ...values,
    ...(facts.visitOrdered === undefined ? {} : { [VISIT_ORDERED]: facts.visitOrdered }),
  });
}

/** A form as the apps hold it: its current version, and whether it is in use. */
export const FormView = FormDefinition.extend({
  id: z.uuid(),
  version: z.int().min(1),
  active: z.boolean(),
}).meta({ id: 'FormView' });

/** `GET /v1/forms`: every form, in use or not, at its current version. */
export const FormListResult = z.object({ items: z.array(FormView) });

/**
 * `POST /v1/forms` and `POST /v1/forms/{id}/versions`: a form's first version, or its next. Its
 * key never changes, and a field keeps its type once a version has used it, so every submission
 * still reads as it was entered.
 */
export const PublishFormBody = z.strictObject({ definition: FormDefinition });

/** `PATCH /v1/forms/{id}`: switch a form off or on; its versions stay. */
export const UpdateFormBody = z.strictObject({ active: z.boolean() });

export type FormView = z.output<typeof FormView>;
export type FormListResult = z.output<typeof FormListResult>;
export type PublishFormBody = z.output<typeof PublishFormBody>;
export type UpdateFormBody = z.output<typeof UpdateFormBody>;
