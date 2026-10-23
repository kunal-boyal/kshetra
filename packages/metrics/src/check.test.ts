import { FormDefinition } from '@thelamp/forms';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { checkMetrics, checkScore, type MetricContext } from './check';
import { MetricDefinition, ScoreDefinition } from './definition';

const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });

const callReport = FormDefinition.parse({
  key: 'call_report',
  name: noun('Call report'),
  icon: 'phone',
  accountLink: { mode: 'required', accountTypes: ['customer'] },
  fields: [
    {
      key: 'kind',
      type: 'single_select',
      label: text('Kind'),
      options: [
        { key: 'new', label: text('New') },
        { key: 'repeat', label: text('Repeat') },
      ],
    },
    { key: 'amount', type: 'currency', label: text('Amount') },
    { key: 'units', type: 'number', label: text('Units') },
    { key: 'items', type: 'product_lines', label: text('Items') },
  ],
});

const meeting = FormDefinition.parse({
  key: 'meeting',
  name: noun('Meeting'),
  icon: 'users',
  fields: [
    { key: 'topic', type: 'short_text', label: text('Topic') },
    { key: 'amount', type: 'number', label: text('Amount') },
  ],
});

const context: MetricContext = {
  forms: new Map([
    ['call_report', callReport],
    ['meeting', meeting],
  ]),
  accountTypes: new Map([['customer', { segments: new Set(['key_account']) }]]),
  roles: new Set(['manager']),
};

type MetricInput = z.input<typeof MetricDefinition>;

const metric = (key: string, unit: MetricInput['unit'], source: MetricInput['source']) =>
  MetricDefinition.parse({ key, name: noun(key), unit, source });

const calls = metric('calls', 'count', { type: 'submission_count', forms: ['call_report'] });
const lines = metric('lines', 'count', { type: 'order_lines', statuses: ['accepted'] });

/** The issues of `metrics`, as `path: issue` lines. */
const issuesOf = (...metrics: MetricDefinition[]) =>
  checkMetrics(metrics, context).map(({ path, issue }) => `${path}: ${issue}`);

describe('metric definitions', () => {
  it('pass when consistent', () => {
    expect(
      issuesOf(
        calls,
        lines,
        metric('new_calls', 'count', {
          type: 'submission_count',
          forms: ['call_report'],
          where: { clauses: [{ field: 'kind', op: 'eq', value: 'new' }] },
        }),
        metric('billed', 'currency', {
          type: 'submission_field_sum',
          forms: ['call_report'],
          field: 'amount',
        }),
        metric('units', 'quantity', {
          type: 'submission_field_sum',
          forms: ['call_report'],
          field: 'units',
        }),
        metric('coverage', 'percent', {
          type: 'coverage_percent',
          forms: ['call_report'],
          accountTypes: ['customer'],
          segment: 'key_account',
        }),
        metric('lines_per_call', 'quantity', {
          type: 'ratio',
          numerator: 'lines',
          denominator: 'calls',
        }),
        metric('active', 'count', { type: 'active_days', forms: ['call_report', 'meeting'] }),
      ),
    ).toEqual([]);
  });

  it('defaults to higher is better and targetable', () => {
    expect(calls.direction).toBe('higher_is_better');
    expect(calls.targetable).toBe(true);
  });

  it('rejects unknown source types and units', () => {
    const parse = (input: object) => MetricDefinition.safeParse({ ...calls, ...input }).success;
    expect(parse({ source: { type: 'submission_average', forms: ['call_report'] } })).toBe(false);
    expect(parse({ unit: 'kg' })).toBe(false);
    expect(
      parse({ source: { type: 'order_value', statuses: ['shipped'], amount: 'before_tax' } }),
    ).toBe(false);
  });

  it('needs the unit to follow from the source', () => {
    expect(
      issuesOf(
        metric('a', 'currency', { type: 'submission_count', forms: ['call_report'] }),
        metric('b', 'count', {
          type: 'submission_field_sum',
          forms: ['call_report'],
          field: 'amount',
        }),
        metric('c', 'count', { type: 'coverage_percent', forms: ['call_report'] }),
      ),
    ).toEqual([
      '[0].unit: A submission_count metric measures in `count`',
      '[1].unit: A submission_field_sum metric measures in `currency`',
      '[2].unit: A coverage_percent metric measures in `percent`',
    ]);
  });

  it('checks the forms and fields a source names', () => {
    expect(
      issuesOf(
        metric('a', 'count', { type: 'submission_count', forms: ['survey', 'meeting', 'meeting'] }),
        metric('b', 'currency', {
          type: 'submission_field_sum',
          forms: ['call_report'],
          field: 'kind',
        }),
        metric('c', 'currency', {
          type: 'submission_field_sum',
          forms: ['call_report', 'meeting'],
          field: 'amount',
        }),
        metric('d', 'currency', {
          type: 'product_line_sum',
          forms: ['call_report'],
          field: 'items',
          column: 'value',
        }),
        metric('e', 'count', {
          type: 'submission_count',
          forms: ['call_report', 'meeting'],
          where: { clauses: [{ field: 'kind', op: 'eq', value: 'new' }] },
        }),
      ),
    ).toEqual([
      '[0].source.forms[0]: There is no form `survey`',
      '[0].source.forms[2]: Form `meeting` appears more than once',
      '[1].source.field: Form `call_report` has no number or currency field `kind`',
      '[2].source.field: `amount` is a number in one form and currency in another',
      '[3].source.column: `items` in form `call_report` has no value column',
      '[4].source.where.clauses[0].field: Form `meeting` has no field `kind`',
    ]);
  });

  it('counts visits only through forms linked to accounts, and checks account filters', () => {
    expect(
      issuesOf(
        metric('a', 'count', { type: 'distinct_accounts_visited', forms: ['meeting'] }),
        metric('b', 'percent', {
          type: 'coverage_percent',
          forms: ['call_report'],
          accountTypes: ['vendor'],
          segment: 'dormant',
        }),
        metric('c', 'count', { type: 'new_accounts', accountType: 'vendor' }),
      ),
    ).toEqual([
      "[0].source.forms: Form `meeting` doesn't link to an account, so it can't count visits to one",
      '[1].source.accountTypes[0]: There is no account type `vendor`',
      '[1].source.segment: No listed account type has segment `dormant`',
      '[2].source.accountType: There is no account type `vendor`',
    ]);
  });

  it('builds ratios only from metrics that sum across days and users (BR-04)', () => {
    const coverage = metric('coverage', 'percent', {
      type: 'coverage_percent',
      forms: ['call_report'],
    });
    expect(
      issuesOf(
        calls,
        coverage,
        metric('a', 'quantity', { type: 'ratio', numerator: 'a', denominator: 'calls' }),
        metric('b', 'quantity', { type: 'ratio', numerator: 'calls', denominator: 'visits' }),
        metric('c', 'quantity', { type: 'ratio', numerator: 'coverage', denominator: 'calls' }),
      ),
    ).toEqual([
      '[2].source.numerator: A ratio cannot use itself',
      '[3].source.denominator: There is no metric `visits`',
      "[4].source.numerator: `coverage` doesn't sum across days and users, so a ratio can't use it (BR-04)",
    ]);
  });

  it('needs unique keys and known roles', () => {
    const hidden = MetricDefinition.parse({ ...calls, visibleRoles: ['manager', 'auditor'] });
    expect(issuesOf(calls, hidden)).toEqual([
      '[1].key: Metric `calls` appears more than once',
      '[1].visibleRoles[1]: There is no role `auditor`',
    ]);
  });
});

describe('the score definition', () => {
  const metrics = new Map([
    ['calls', calls],
    ['lines', lines],
    ['info', MetricDefinition.parse({ ...lines, key: 'info', targetable: false })],
  ]);

  it('fills in the defaults of BR-06 and decision D8', () => {
    const score = ScoreDefinition.parse({ metrics: [{ metric: 'calls', weight: 50 }] });
    expect(score).toEqual({
      periodType: 'month',
      cap: 1,
      rankingGroupBy: 'designation',
      metrics: [{ metric: 'calls', weight: 50 }],
    });
    expect(checkScore(score, metrics)).toEqual([]);
  });

  it('rejects caps below 100% and weights that are not whole numbers', () => {
    expect(
      ScoreDefinition.safeParse({ cap: 0.8, metrics: [{ metric: 'calls', weight: 1 }] }).success,
    ).toBe(false);
    expect(
      ScoreDefinition.safeParse({ metrics: [{ metric: 'calls', weight: 12.5 }] }).success,
    ).toBe(false);
  });

  it('scores only known, targetable metrics, each once', () => {
    const score = ScoreDefinition.parse({
      metrics: [
        { metric: 'calls', weight: 40 },
        { metric: 'calls', weight: 10 },
        { metric: 'visits', weight: 25 },
        { metric: 'info', weight: 25 },
      ],
    });
    expect(checkScore(score, metrics).map(({ path, issue }) => `${path}: ${issue}`)).toEqual([
      'metrics[1].metric: Metric `calls` appears more than once',
      'metrics[2].metric: There is no metric `visits`',
      "metrics[3].metric: `info` can't carry a target, so it can't be scored (BR-06)",
    ]);
  });
});
