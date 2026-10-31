import { type AnyField, checkCondition, type FormDefinition } from '@thelamp/forms';
import { type ErrorDetail, issueAt, repeats } from '@thelamp/shared';
import type {
  MetricDefinition,
  MetricSource,
  MetricSourceType,
  MetricUnit,
  ScoreDefinition,
} from './definition';

type Path = readonly PropertyKey[];

/** What metric definitions may refer to. */
export interface MetricContext {
  forms: ReadonlyMap<string, FormDefinition>;
  /** Account types by key, with the segments their rules can tag. */
  accountTypes: ReadonlyMap<string, { segments: ReadonlySet<string> }>;
  roles: ReadonlySet<string>;
}

/** The units a source type can produce, where the source alone decides. */
const UNITS: Partial<Record<MetricSourceType, readonly MetricUnit[]>> = {
  submission_count: ['count'],
  distinct_accounts_visited: ['count'],
  coverage_percent: ['percent'],
  frequency_compliance_percent: ['percent'],
  plan_compliance_percent: ['percent'],
  visit_duration: ['duration'],
  order_value: ['currency'],
  order_quantity: ['quantity'],
  productive_visits: ['count'],
  order_lines: ['count'],
  active_days: ['count'],
  new_accounts: ['count'],
};

/** Sources whose daily values sum across days and users, so a ratio can use them (BR-04). */
function isAdditive(source: MetricSource): boolean {
  switch (source.type) {
    case 'distinct_accounts_visited':
    case 'coverage_percent':
    case 'frequency_compliance_percent':
    case 'plan_compliance_percent':
    case 'ratio':
      return false;
    case 'visit_duration':
      return source.aggregate === 'sum';
    default:
      return true;
  }
}

const list = (values: readonly string[]) => values.map((value) => `\`${value}\``).join(', ');

/** The form's top-level fields by key. Fields inside repeating groups hold many values. */
function fieldsOf(form: FormDefinition): Map<string, AnyField> {
  return new Map(form.fields.map((field) => [field.key, field]));
}

function checkMetric(
  metric: MetricDefinition,
  metrics: ReadonlyMap<string, MetricDefinition>,
  context: MetricContext,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));
  const { source } = metric;

  const formKeys = 'forms' in source ? source.forms : [];
  formKeys.forEach((key, index) => {
    if (!context.forms.has(key)) at(['source', 'forms', index], `There is no form \`${key}\``);
  });
  for (const index of repeats(formKeys)) {
    at(['source', 'forms', index], `Form \`${formKeys[index]}\` appears more than once`);
  }
  const forms = formKeys.flatMap((key) => context.forms.get(key) ?? []);

  const types = 'accountTypes' in source ? (source.accountTypes ?? []) : [];
  types.forEach((key, index) => {
    if (!context.accountTypes.has(key)) {
      at(['source', 'accountTypes', index], `There is no account type \`${key}\``);
    }
  });
  if ('segment' in source && source.segment !== undefined) {
    const candidates = types.length > 0 ? types : [...context.accountTypes.keys()];
    const tagged = candidates.some((key) =>
      context.accountTypes.get(key)?.segments.has(source.segment!),
    );
    if (!tagged) {
      at(
        ['source', 'segment'],
        `No ${types.length > 0 ? 'listed ' : ''}account type has segment \`${source.segment}\``,
      );
    }
  }

  let units = UNITS[source.type];
  switch (source.type) {
    case 'submission_count':
      if (source.where) {
        for (const form of forms) {
          issues.push(
            ...checkCondition(
              source.where,
              fieldsOf(form),
              [...path, 'source', 'where'],
              (key) => `Form \`${form.key}\` has no field \`${key}\``,
            ),
          );
        }
      }
      break;
    case 'submission_field_sum': {
      const fieldTypes = new Set<string>();
      for (const form of forms) {
        const field = fieldsOf(form).get(source.field);
        // A calculated field sums as what it holds (decision D118).
        const type = field?.type === 'calculated' ? field.result : field?.type;
        if (type === 'number' || type === 'currency') fieldTypes.add(type);
        else
          at(
            ['source', 'field'],
            `Form \`${form.key}\` has no number or currency field \`${source.field}\``,
          );
      }
      if (fieldTypes.size > 1) {
        at(
          ['source', 'field'],
          `\`${source.field}\` is a number in one form and currency in another`,
        );
      }
      // With no usable field, the unit can't be judged; the field issue says what to fix.
      if (fieldTypes.size > 0)
        units = fieldTypes.has('currency') ? ['currency'] : ['count', 'quantity'];
      break;
    }
    case 'product_line_sum':
      for (const form of forms) {
        const field = fieldsOf(form).get(source.field);
        if (field?.type !== 'product_lines') {
          at(
            ['source', 'field'],
            `Form \`${form.key}\` has no product lines field \`${source.field}\``,
          );
        } else if (source.column === 'value' && !field.valueColumn) {
          at(
            ['source', 'column'],
            `\`${source.field}\` in form \`${form.key}\` has no value column`,
          );
        }
      }
      units = source.column === 'value' ? ['currency'] : ['quantity', 'count'];
      break;
    case 'distinct_accounts_visited':
    case 'coverage_percent':
    case 'frequency_compliance_percent':
      for (const form of forms) {
        if (form.accountLink.mode === 'none') {
          at(
            ['source', 'forms'],
            `Form \`${form.key}\` doesn't link to an account, so it can't count visits to one`,
          );
        }
      }
      break;
    case 'new_accounts':
      if (!context.accountTypes.has(source.accountType)) {
        at(['source', 'accountType'], `There is no account type \`${source.accountType}\``);
      }
      break;
    case 'ratio':
      for (const part of ['numerator', 'denominator'] as const) {
        const operand = metrics.get(source[part]);
        if (source[part] === metric.key) at(['source', part], 'A ratio cannot use itself');
        else if (!operand) at(['source', part], `There is no metric \`${source[part]}\``);
        else if (!isAdditive(operand.source)) {
          at(
            ['source', part],
            `\`${operand.key}\` doesn't sum across days and users, so a ratio can't use it (BR-04)`,
          );
        }
      }
      break;
    default:
      break;
  }
  if (units && !units.includes(metric.unit)) {
    at(['unit'], `A ${source.type} metric measures in ${list(units)}`);
  }

  metric.visibleRoles?.forEach((role, index) => {
    if (!context.roles.has(role)) at(['visibleRoles', index], `There is no role \`${role}\``);
  });
  return issues;
}

/** Checks metric definitions beyond their shape: unique keys, references and units. */
export function checkMetrics(
  metrics: readonly MetricDefinition[],
  context: MetricContext,
  path: Path = [],
): ErrorDetail[] {
  const keys = metrics.map((metric) => metric.key);
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return [
    ...repeats(keys).map((index) =>
      issueAt([...path, index, 'key'], `Metric \`${keys[index]}\` appears more than once`),
    ),
    ...metrics.flatMap((metric, index) => checkMetric(metric, byKey, context, [...path, index])),
  ];
}

/** Checks that a score uses each targetable metric at most once (BR-06). */
export function checkScore(
  score: ScoreDefinition,
  metrics: ReadonlyMap<string, MetricDefinition>,
  path: Path = [],
): ErrorDetail[] {
  const keys = score.metrics.map(({ metric }) => metric);
  const issues = repeats(keys).map((index) =>
    issueAt(
      [...path, 'metrics', index, 'metric'],
      `Metric \`${keys[index]}\` appears more than once`,
    ),
  );
  keys.forEach((key, index) => {
    const metric = metrics.get(key);
    if (!metric) {
      issues.push(issueAt([...path, 'metrics', index, 'metric'], `There is no metric \`${key}\``));
    } else if (!metric.targetable) {
      issues.push(
        issueAt(
          [...path, 'metrics', index, 'metric'],
          `\`${key}\` can't carry a target, so it can't be scored (BR-06)`,
        ),
      );
    }
  });
  return issues;
}
