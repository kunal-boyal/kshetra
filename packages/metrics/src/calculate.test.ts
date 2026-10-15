import { describe, expect, it } from 'vitest';
import {
  calculateDayFacts,
  computed,
  type DayRecords,
  type DaySubmission,
  decimal,
  thousandths,
} from './calculate';
import { MetricDefinition } from './definition';

const name = { en: { one: 'M', other: 'Ms' }, hi: { one: 'M', other: 'Ms' } };
const metric = (key: string, unit: string, source: object) =>
  MetricDefinition.parse({ key, name, unit, source });

const SHOP = { id: 'a1', typeKey: 'customer', segments: ['active'] };
const DEPOT = { id: 'a2', typeKey: 'depot', segments: [] };

const submission = (
  status: DaySubmission['status'],
  data: Record<string, unknown> = {},
  account: DaySubmission['account'] = SHOP,
  formKey = 'visit',
): DaySubmission => ({ formKey, status, data, account });

function day(overrides: Partial<DayRecords> = {}): DayRecords {
  return {
    date: '2026-10-14',
    today: '2026-10-15',
    submissions: [],
    visits: [],
    planItems: [],
    ...overrides,
  };
}

const byKey = (facts: ReturnType<typeof calculateDayFacts>) =>
  Object.fromEntries(facts.map((fact) => [fact.key, fact]));

describe('decimals', () => {
  it('sum in thousandths, never binary fractions', () => {
    expect(thousandths('0.1')! + thousandths(0.2)!).toBe(300n);
    expect(thousandths('12.3456')).toBe(12346n);
    expect(thousandths('-4')).toBe(-4000n);
    expect(thousandths('abc')).toBeNull();
    expect(decimal(-1500n)).toBe('-1.500');
  });
});

describe("a person's day (spec 5.7)", () => {
  it('FX-05: counts approved submissions, pending ones apart', () => {
    const facts = calculateDayFacts(
      [metric('visits', 'count', { type: 'submission_count', forms: ['visit'] })],
      day({
        submissions: [
          submission('approved'),
          submission('approved'),
          submission('pending'),
          submission('rejected'),
        ],
      }),
    );
    expect(facts).toEqual([
      expect.objectContaining({ key: 'visits', value: '2.000', pending: '1.000' }),
    ]);
  });

  it('counts only submissions whose fields match the condition', () => {
    const facts = calculateDayFacts(
      [
        metric('orders_taken', 'count', {
          type: 'submission_count',
          forms: ['visit'],
          where: { match: 'all', clauses: [{ field: 'ordered', op: 'eq', value: true }] },
        }),
      ],
      day({
        submissions: [
          submission('approved', { ordered: true }),
          submission('approved', { ordered: false }),
        ],
      }),
    );
    expect(facts[0]!.value).toBe('1.000');
  });

  it('sums a field exactly, from strings and numbers', () => {
    const facts = calculateDayFacts(
      [
        metric('sales', 'currency', {
          type: 'submission_field_sum',
          forms: ['visit'],
          field: 'sales',
        }),
      ],
      day({
        submissions: [
          submission('approved', { sales: '1000.10' }),
          submission('approved', { sales: 0.2 }),
          submission('approved', {}),
          submission('pending', { sales: '50' }),
          submission('approved', { sales: '5' }, SHOP, 'other'),
        ],
      }),
    );
    expect(facts[0]).toMatchObject({ value: '1000.300', pending: '50.000' });
  });

  it('keeps the distinct accounts visited, by type and segment', () => {
    const facts = byKey(
      calculateDayFacts(
        [
          metric('covered', 'count', {
            type: 'distinct_accounts_visited',
            forms: ['visit'],
            accountTypes: ['customer'],
            segment: 'active',
          }),
          metric('coverage', 'percent', { type: 'coverage_percent', forms: ['visit'] }),
        ],
        day({
          submissions: [
            submission('approved'),
            submission('approved'),
            submission('approved', {}, DEPOT),
            submission('pending', {}, { ...SHOP, id: 'a3' }),
            submission('approved', {}, null),
          ],
        }),
      ),
    );
    expect(facts.covered).toMatchObject({ value: '1.000', accounts: ['a1'] });
    expect(facts.coverage).toMatchObject({ accounts: ['a1', 'a2'] });
  });

  it('BR-05: an active day needs an approved submission of a counted form', () => {
    const active = metric('active_days', 'count', { type: 'active_days', forms: ['visit'] });
    expect(
      calculateDayFacts([active], day({ submissions: [submission('pending')] }))[0],
    ).toMatchObject({ value: '0.000', pending: '1.000' });
    expect(
      calculateDayFacts(
        [active],
        day({ submissions: [submission('approved'), submission('approved')] }),
      )[0],
    ).toMatchObject({ value: '1.000', pending: '0.000' });
  });

  it('counts plan items due once their day has ended', () => {
    const plan = metric('plan', 'percent', { type: 'plan_compliance_percent' });
    const planItems = [
      { status: 'completed' as const },
      { status: 'missed' as const },
      { status: 'cancelled' as const },
      { status: 'visited' as const },
    ];
    expect(calculateDayFacts([plan], day({ planItems }))[0]).toMatchObject({
      numerator: '1.000',
      denominator: '3.000',
      value: '33.333',
    });
    expect(calculateDayFacts([plan], day({ planItems, date: '2026-10-15' }))[0]).toMatchObject({
      numerator: '1.000',
      denominator: '1.000',
    });
  });

  it('adds up checked-in minutes of finished visits', () => {
    const visits = [
      { account: SHOP, checkInAt: '2026-10-14T04:00:00Z', checkOutAt: '2026-10-14T04:30:00Z' },
      { account: DEPOT, checkInAt: '2026-10-14T05:00:00Z', checkOutAt: '2026-10-14T05:15:30Z' },
      { account: SHOP, checkInAt: '2026-10-14T06:00:00Z', checkOutAt: null },
    ];
    const facts = byKey(
      calculateDayFacts(
        [
          metric('time', 'duration', { type: 'visit_duration', aggregate: 'sum' }),
          metric('avg', 'duration', { type: 'visit_duration', aggregate: 'average' }),
        ],
        day({ visits }),
      ),
    );
    expect(facts.time).toMatchObject({ value: '45.500', denominator: '2.000' });
    expect(facts.avg).toMatchObject({ value: '22.750', numerator: '45.500' });
  });

  it('divides a ratio from its parts, after them', () => {
    const metrics = [
      metric('per_visit', 'currency', { type: 'ratio', numerator: 'sales', denominator: 'visits' }),
      metric('sales', 'currency', {
        type: 'submission_field_sum',
        forms: ['visit'],
        field: 'sales',
      }),
      metric('visits', 'count', { type: 'submission_count', forms: ['visit'] }),
    ];
    const facts = byKey(
      calculateDayFacts(
        metrics,
        day({
          submissions: [
            submission('approved', { sales: '100' }),
            submission('approved', { sales: '50' }),
          ],
        }),
      ),
    );
    expect(facts.per_visit).toMatchObject({
      value: '75.000',
      numerator: '150.000',
      denominator: '2.000',
    });
  });

  it('leaves out sources that wait for their records', () => {
    const metrics = [
      metric('order_value', 'currency', {
        type: 'order_value',
        statuses: ['accepted'],
        amount: 'before_tax',
      }),
      metric('visits', 'count', { type: 'submission_count', forms: ['visit'] }),
      metric('per_order', 'count', {
        type: 'ratio',
        numerator: 'visits',
        denominator: 'order_value',
      }),
    ];
    const map = new Map(metrics.map((m) => [m.key, m]));
    expect(metrics.map((m) => computed(m, map))).toEqual([false, true, false]);
    expect(calculateDayFacts(metrics, day()).map((fact) => fact.key)).toEqual(['visits']);
  });
});
