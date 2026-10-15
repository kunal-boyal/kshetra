import { conditionHolds } from '@kshetra/forms';
import type { MetricDefinition, MetricSourceType } from './definition';

/**
 * The metric engine's calculators (spec 5.7, 12.5): one person's day, from the records it holds,
 * to a fact per metric. They run in memory on rows the server loads for that day, so the same
 * code is tested with plain fixtures. Values are decimal strings with three places, the scale of
 * `metric_facts_daily`, and are summed as integer thousandths, never as binary fractions.
 */

/** Sources the engine computes now (decision D56); the rest wait for the records they read. */
export const COMPUTED_SOURCES = [
  'submission_count',
  'submission_field_sum',
  'distinct_accounts_visited',
  'coverage_percent',
  'plan_compliance_percent',
  'visit_duration',
  'active_days',
  'ratio',
] as const satisfies readonly MetricSourceType[];

/** Whether the engine computes a metric: its source, and for a ratio both of its parts. */
export function computed(
  metric: MetricDefinition,
  byKey: ReadonlyMap<string, MetricDefinition>,
): boolean {
  const source = metric.source;
  if (source.type === 'ratio') {
    const parts = [byKey.get(source.numerator), byKey.get(source.denominator)];
    return parts.every(
      (part) => part !== undefined && part.source.type !== 'ratio' && computed(part, byKey),
    );
  }
  return (COMPUTED_SOURCES as readonly string[]).includes(source.type);
}

export interface DayAccount {
  id: string;
  typeKey: string;
  segments: readonly string[];
}

export interface DaySubmission {
  formKey: string;
  status: 'pending' | 'approved' | 'rejected';
  data: Record<string, unknown>;
  account: DayAccount | null;
}

export interface DayVisit {
  account: DayAccount;
  checkInAt: string;
  /** Null while the visit is open; open visits don't count. */
  checkOutAt: string | null;
}

export interface DayPlanItem {
  status: 'planned' | 'visited' | 'completed' | 'missed' | 'cancelled';
}

export interface DayRecords {
  /** `YYYY-MM-DD` on the tenant's clock. */
  date: string;
  /** Today on the tenant's clock: a plan item falls due once its day has ended. */
  today: string;
  submissions: readonly DaySubmission[];
  visits: readonly DayVisit[];
  planItems: readonly DayPlanItem[];
}

/** One metric's fact for one person and day. */
export interface DayFact {
  key: string;
  value: string;
  numerator: string | null;
  denominator: string | null;
  /** What pending submissions would add (BR-02), shown apart; null where it means nothing. */
  pending: string | null;
  /** The accounts behind a distinct count, so a period's distinct count stays exact (12.5). */
  accounts: string[];
}

const SCALE = 1000n;

/** A number or decimal string as integer thousandths, rounded half away from zero. */
export function thousandths(value: unknown): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (typeof text !== 'string') return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const digits = BigInt(`${whole}${fraction.padEnd(3, '0').slice(0, 3)}`);
  const up = fraction.length > 3 && Number(fraction[3]) >= 5 ? 1n : 0n;
  const magnitude = digits + up;
  return sign === '-' ? -magnitude : magnitude;
}

/** Integer thousandths as a decimal string with three places. */
export function decimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = String(magnitude % SCALE).padStart(3, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function count(n: number): string {
  return decimal(BigInt(n) * SCALE);
}

function accountMatches(
  account: DayAccount | null,
  types: readonly string[] | undefined,
  segment: string | undefined,
): account is DayAccount {
  if (!account) return false;
  if (types && !types.includes(account.typeKey)) return false;
  return !segment || account.segments.includes(segment);
}

function fact(key: string, value: string, extra: Partial<DayFact> = {}): DayFact {
  return { key, value, numerator: null, denominator: null, pending: null, accounts: [], ...extra };
}

/**
 * The day's fact for one metric, or null when the engine doesn't compute its source. Ratios come
 * from their parts' facts, so pass those in `parts`.
 */
export function calculateDay(
  metric: MetricDefinition,
  day: DayRecords,
  parts: ReadonlyMap<string, DayFact> = new Map(),
): DayFact | null {
  const source = metric.source;
  const key = metric.key;
  const ofForms = (forms: readonly string[]) =>
    day.submissions.filter((submission) => forms.includes(submission.formKey));
  switch (source.type) {
    case 'submission_count': {
      const counted = ofForms(source.forms).filter(
        (submission) => !source.where || conditionHolds(source.where, submission.data),
      );
      const approved = counted.filter((submission) => submission.status === 'approved').length;
      const pending = counted.filter((submission) => submission.status === 'pending').length;
      return fact(key, count(approved), { pending: count(pending) });
    }
    case 'submission_field_sum': {
      let approved = 0n;
      let pending = 0n;
      for (const submission of ofForms(source.forms)) {
        const amount = thousandths(submission.data[source.field]) ?? 0n;
        if (submission.status === 'approved') approved += amount;
        if (submission.status === 'pending') pending += amount;
      }
      return fact(key, decimal(approved), { pending: decimal(pending) });
    }
    case 'distinct_accounts_visited':
    case 'coverage_percent': {
      const visited = new Set<string>();
      for (const submission of ofForms(source.forms)) {
        if (
          submission.status === 'approved' &&
          accountMatches(submission.account, source.accountTypes, source.segment)
        ) {
          visited.add(submission.account.id);
        }
      }
      const accounts = [...visited].sort();
      // Coverage divides by the accounts assigned over the period, which only a period knows.
      return fact(key, count(accounts.length), { accounts });
    }
    case 'active_days': {
      const counted = ofForms(source.forms);
      const approved = counted.some((submission) => submission.status === 'approved');
      const pending = !approved && counted.some((submission) => submission.status === 'pending');
      return fact(key, count(approved ? 1 : 0), { pending: count(pending ? 1 : 0) });
    }
    case 'plan_compliance_percent': {
      const live = day.planItems.filter((item) => item.status !== 'cancelled');
      const completed = live.filter((item) => item.status === 'completed').length;
      // An item falls due once its day has ended; one completed early counts on its day.
      const due = day.date < day.today ? live.length : completed;
      return fact(
        key,
        due > 0 ? decimal((BigInt(completed) * 100n * SCALE) / BigInt(due)) : '0.000',
        {
          numerator: count(completed),
          denominator: count(due),
        },
      );
    }
    case 'visit_duration': {
      let minutes = 0n;
      let visits = 0;
      for (const visit of day.visits) {
        if (!visit.checkOutAt || !accountMatches(visit.account, source.accountTypes, undefined)) {
          continue;
        }
        const ms = Date.parse(visit.checkOutAt) - Date.parse(visit.checkInAt);
        if (!(ms > 0)) continue;
        minutes += (BigInt(ms) * SCALE + 30_000n) / 60_000n;
        visits += 1;
      }
      const value =
        source.aggregate === 'sum' ? minutes : visits > 0 ? minutes / BigInt(visits) : 0n;
      return fact(key, decimal(value), { numerator: decimal(minutes), denominator: count(visits) });
    }
    case 'ratio': {
      const top = parts.get(source.numerator);
      const bottom = parts.get(source.denominator);
      if (!top || !bottom) return null;
      const numerator = thousandths(top.value) ?? 0n;
      const denominator = thousandths(bottom.value) ?? 0n;
      const times = metric.unit === 'percent' ? 100n : 1n;
      return fact(
        key,
        denominator > 0n ? decimal((numerator * times * SCALE) / denominator) : '0.000',
        { numerator: decimal(numerator), denominator: decimal(denominator) },
      );
    }
    default:
      return null;
  }
}

/** Every computed metric's fact for one person's day: ratios after the parts they divide. */
export function calculateDayFacts(
  metrics: readonly MetricDefinition[],
  day: DayRecords,
): DayFact[] {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const facts = new Map<string, DayFact>();
  const ordered = [
    ...metrics.filter((metric) => metric.source.type !== 'ratio'),
    ...metrics.filter((metric) => metric.source.type === 'ratio'),
  ];
  for (const metric of ordered) {
    if (!computed(metric, byKey)) continue;
    const result = calculateDay(metric, day, facts);
    if (result) facts.set(metric.key, result);
  }
  return [...facts.values()];
}
