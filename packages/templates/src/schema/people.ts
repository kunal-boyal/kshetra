import {
  type ErrorDetail,
  issueAt,
  Key,
  LocalizedText,
  Money,
  repeats,
  toMinorUnits,
} from '@kshetra/shared';
import { z } from 'zod';
import { repeatedKeys } from './organisation';

type Path = readonly PropertyKey[];

/** A named calendar with weekly offs; dated holidays are loaded per year (spec B.7). */
export const HolidayCalendar = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    weeklyOffs: z.array(z.int().min(1).max(7)).max(6).meta({
      description: 'ISO weekdays: 1 is Monday, 7 is Sunday',
    }),
  })
  .meta({ id: 'HolidayCalendar' });

/** What makes a day present (spec 5.10, BR-23). */
export const AttendanceRule = z
  .discriminatedUnion('rule', [
    z.strictObject({ rule: z.literal('punch_is_present') }),
    z.strictObject({
      rule: z.literal('hours'),
      fullDayHours: z.number().min(1).max(24),
      halfDayHours: z.number().min(0.5).max(24),
    }),
  ])
  .meta({ id: 'AttendanceRule' });

export const LeaveType = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    paid: z.boolean(),
    annualQuota: z.number().min(0).max(366).multipleOf(0.5).meta({
      description: 'Days per quota year; 0 means the type has no quota',
    }),
    quotaYear: z.enum(['calendar', 'financial']),
    halfDayAllowed: z.boolean(),
    attachmentAfterDays: z.int().min(1).max(366).optional().meta({
      description: 'Requests longer than this many days need an attachment',
    }),
    active: z.boolean().default(true),
  })
  .meta({ id: 'LeaveType' });

/** A flat rate, or a rate for each designation. */
export const ExpenseRate = z
  .union([z.strictObject({ flat: Money }), z.strictObject({ byDesignation: z.record(Key, Money) })])
  .meta({ id: 'ExpenseRate' });

/** How a claim's amount is calculated and capped (spec 5.10, BR-29). */
export const ExpensePolicy = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    category: z.enum(['travel', 'daily_allowance', 'other']),
    calculation: z.enum(['per_km', 'per_day', 'per_visit', 'actual']),
    rate: ExpenseRate.optional().meta({
      description: 'Per km, day or visit. Leave out when the claim is the bill amount (actual).',
    }),
    caps: z
      .strictObject({
        perClaim: Money.optional(),
        perDay: Money.optional(),
        perMonth: Money.optional(),
      })
      .default({}),
    receiptRequired: z.boolean().default(false),
    odometerPhotosRequired: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .meta({ id: 'ExpensePolicy' });

/** Holiday calendars, the attendance rule, leave types and expense policies (spec 5.10). */
export const People = z.strictObject({
  calendars: z.array(HolidayCalendar).min(1).max(50),
  defaultCalendar: Key.meta({ description: 'The calendar new users belong to' }),
  attendance: AttendanceRule,
  leaveTypes: z.array(LeaveType).max(30).default([]),
  expensePolicies: z.array(ExpensePolicy).max(30).default([]),
});

export type People = z.output<typeof People>;
export type ExpensePolicy = z.output<typeof ExpensePolicy>;

function checkExpensePolicy(
  policy: ExpensePolicy,
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));
  const positive = (amount: string, rest: readonly PropertyKey[]) => {
    if (toMinorUnits(amount) === 0n) at(rest, 'Use an amount above zero');
  };

  if (policy.calculation === 'actual') {
    if (policy.rate) at(['rate'], 'A claim of the bill amount takes no rate');
  } else if (!policy.rate) {
    at(['rate'], `A ${policy.calculation} policy needs a rate`);
  } else if ('flat' in policy.rate) {
    positive(policy.rate.flat, ['rate', 'flat']);
  } else {
    const rates = Object.entries(policy.rate.byDesignation);
    if (rates.length === 0)
      at(['rate', 'byDesignation'], 'Give a rate for at least one designation');
    for (const [designation, amount] of rates) {
      if (!designations.has(designation)) {
        at(['rate', 'byDesignation', designation], `There is no designation \`${designation}\``);
      }
      positive(amount, ['rate', 'byDesignation', designation]);
    }
  }
  for (const [cap, amount] of Object.entries(policy.caps)) {
    if (amount !== undefined) positive(amount, ['caps', cap]);
  }
  if (policy.odometerPhotosRequired && policy.calculation !== 'per_km') {
    at(['odometerPhotosRequired'], 'Odometer photos apply to per-km claims only');
  }
  return issues;
}

/** Checks people policies: known calendars and designations, and amounts that make sense. */
export function checkPeople(
  people: People,
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [
    ...repeatedKeys(people.calendars, [...path, 'calendars'], 'Calendar'),
    ...repeatedKeys(people.leaveTypes, [...path, 'leaveTypes'], 'Leave type'),
    ...repeatedKeys(people.expensePolicies, [...path, 'expensePolicies'], 'Expense policy'),
  ];
  if (!people.calendars.some((calendar) => calendar.key === people.defaultCalendar)) {
    issues.push(
      issueAt([...path, 'defaultCalendar'], `There is no calendar \`${people.defaultCalendar}\``),
    );
  }
  people.calendars.forEach((calendar, index) => {
    const days = calendar.weeklyOffs.map(String);
    for (const repeat of repeats(days)) {
      issues.push(
        issueAt(
          [...path, 'calendars', index, 'weeklyOffs', repeat],
          `Day ${days[repeat]} appears more than once`,
        ),
      );
    }
  });
  const { attendance } = people;
  if (attendance.rule === 'hours' && attendance.halfDayHours >= attendance.fullDayHours) {
    issues.push(
      issueAt(
        [...path, 'attendance', 'halfDayHours'],
        'A half day needs fewer hours than a full day',
      ),
    );
  }
  people.expensePolicies.forEach((policy, index) => {
    issues.push(...checkExpensePolicy(policy, designations, [...path, 'expensePolicies', index]));
  });
  return issues;
}
