import { describe, expect, it } from 'vitest';
import {
  calculateDayFacts,
  computed,
  type DayOrder,
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
    orders: [],
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
      metric('new_shops', 'count', { type: 'new_accounts', accountType: 'customer' }),
      metric('visits', 'count', { type: 'submission_count', forms: ['visit'] }),
      metric('per_shop', 'count', {
        type: 'ratio',
        numerator: 'visits',
        denominator: 'new_shops',
      }),
    ];
    const map = new Map(metrics.map((m) => [m.key, m]));
    expect(metrics.map((m) => computed(m, map))).toEqual([false, true, false]);
    expect(calculateDayFacts(metrics, day()).map((fact) => fact.key)).toEqual(['visits']);
  });

  it('sums a product lines column, such as samples given (decision D97)', () => {
    const facts = byKey(
      calculateDayFacts(
        [
          metric('samples', 'count', {
            type: 'product_line_sum',
            forms: ['visit'],
            field: 'samples',
            column: 'quantity',
          }),
          metric('prices', 'currency', {
            type: 'product_line_sum',
            forms: ['visit'],
            field: 'samples',
            column: 'value',
          }),
        ],
        day({
          submissions: [
            submission('approved', {
              samples: [
                { itemId: 'i1', quantity: 2, value: '10.50' },
                { itemId: 'i2', quantity: 3 },
              ],
            }),
            submission('approved', { samples: 'not lines' }),
            submission('pending', { samples: [{ itemId: 'i1', quantity: 4 }] }),
            submission('approved', { samples: [{ itemId: 'i1', quantity: 9 }] }, SHOP, 'other'),
          ],
        }),
      ),
    );
    expect(facts.samples).toMatchObject({ value: '5.000', pending: '4.000' });
    expect(facts.prices).toMatchObject({ value: '10.500', pending: '0.000' });
  });

  it('keeps the accounts called on for frequency compliance, which a period judges', () => {
    const facts = calculateDayFacts(
      [
        metric('frequency', 'percent', {
          type: 'frequency_compliance_percent',
          forms: ['visit'],
          accountTypes: ['customer'],
        }),
      ],
      day({
        submissions: [
          submission('approved'),
          submission('approved', {}, DEPOT),
          submission('pending', {}, { ...SHOP, id: 'a3' }),
        ],
      }),
    );
    expect(facts[0]).toMatchObject({ value: '1.000', accounts: ['a1'] });
  });
});

describe('orders as metric sources (M10, decision D78)', () => {
  const line = (
    decision: DayOrder['lines'][number]['decision'],
    taxable: string,
    total: string,
    baseUnits: string,
    measure: string | null = null,
  ) => ({
    decision,
    taxable,
    total,
    baseUnits,
    measureType: measure === null ? null : ('L' as const),
    measure,
  });
  const order = (
    status: DayOrder['status'],
    lines: DayOrder['lines'],
    visitId: string | null = null,
    account = SHOP,
  ): DayOrder => ({ status, visitId, account, lines });
  const orders = [
    // FX-07 and FX-08: accepted whole.
    order(
      'accepted',
      [
        line('accepted', '8640.00', '10195.20', '24.000', '12.000'),
        line('accepted', '3248.28', '3832.97', '36.000'),
      ],
      'v1',
    ),
    // FX-14: one line rejected for no stock counts for nothing.
    order('partially_accepted', [
      line('accepted', '100.00', '118.00', '10.000', '5.000'),
      line('rejected', '999.00', '1178.82', '99.000'),
    ]),
    order('submitted', [line('pending', '50.00', '59.00', '5.000')], 'v2'),
    order('rejected', [line('rejected', '70.00', '82.60', '7.000')], 'v3', DEPOT),
  ];
  const visit = (id: string, account = SHOP) => ({
    id,
    account,
    checkInAt: '2026-10-14T05:00:00.000Z',
    checkOutAt: '2026-10-14T05:30:00.000Z',
  });

  it('sums order value before or after tax, quantity and lines, from lines that stand', () => {
    const statuses = ['accepted', 'partially_accepted', 'fulfilled'];
    const facts = byKey(
      calculateDayFacts(
        [
          metric('value', 'currency', { type: 'order_value', statuses, amount: 'before_tax' }),
          metric('billed', 'currency', { type: 'order_value', statuses, amount: 'after_tax' }),
          metric('units', 'count', { type: 'order_quantity', statuses, measure: 'base_units' }),
          metric('litres', 'count', { type: 'order_quantity', statuses, measure: 'L' }),
          metric('lines', 'count', { type: 'order_lines', statuses }),
        ],
        day({ orders }),
      ),
    );
    expect(facts.value).toMatchObject({ value: '11988.280', pending: '50.000' });
    expect(facts.billed).toMatchObject({ value: '14146.170', pending: '59.000' });
    expect(facts.units).toMatchObject({ value: '70.000', pending: '5.000' });
    expect(facts.litres).toMatchObject({ value: '17.000', pending: '0.000' });
    expect(facts.lines).toMatchObject({ value: '3.000', pending: '1.000' });
  });

  it('counts a submitted order as it is when its status is chosen', () => {
    const [fact] = calculateDayFacts(
      [
        metric('taken', 'currency', {
          type: 'order_value',
          statuses: ['submitted'],
          amount: 'before_tax',
        }),
      ],
      day({ orders }),
    );
    expect(fact).toMatchObject({ value: '50.000', pending: '0.000' });
  });

  it('counts a visit productive when an order that stands names it', () => {
    const facts = byKey(
      calculateDayFacts(
        [
          metric('productive', 'count', { type: 'productive_visits' }),
          metric('shops', 'count', { type: 'productive_visits', accountTypes: ['customer'] }),
        ],
        day({ orders, visits: [visit('v1'), visit('v2'), visit('v3', DEPOT), visit('v4')] }),
      ),
    );
    expect(facts.productive).toMatchObject({ value: '2.000', accounts: ['a1'] });
    expect(facts.shops?.value).toBe('2.000');
  });
});

describe('external metrics (decision D94)', () => {
  it('sums the values loaded for the person that day, and counts in ratios', () => {
    const secondary = metric('secondary_sales', 'currency', { type: 'external' });
    const share = metric('secondary_share', 'percent', {
      type: 'ratio',
      numerator: 'secondary_sales',
      denominator: 'secondary_sales',
    });
    const facts = byKey(
      calculateDayFacts(
        [secondary, share],
        day({
          external: [
            { metricKey: 'secondary_sales', value: '12500.500' },
            { metricKey: 'secondary_sales', value: '499.5' },
            { metricKey: 'something_else', value: '7' },
          ],
        }),
      ),
    );
    expect(facts.secondary_sales!.value).toBe('13000.000');
    expect(facts.secondary_share!.value).toBe('100.000');
    // Without values loaded, the day holds nothing for it.
    expect(byKey(calculateDayFacts([secondary], day())).secondary_sales!.value).toBe('0.000');
  });
});
