import {
  type ErrorDetail,
  issueAt,
  Key,
  ExpensePolicy,
  ExpenseRate,
  expensePolicyIssues,
  LeaveType,
  LocalizedText,
  repeats,
} from '@thelamp/shared';
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

/** Leave types live in `@thelamp/shared`, as the API takes them too (decision D81). */
export { LeaveType };

/** Expense policies live in `@thelamp/shared`, as the API takes them too (decision D83). */
export { ExpensePolicy, ExpenseRate };

/** Holiday calendars, the attendance rule, leave types and expense policies (spec 5.10). */
export const People = z.strictObject({
  calendars: z.array(HolidayCalendar).min(1).max(50),
  defaultCalendar: Key.meta({ description: 'The calendar new users belong to' }),
  attendance: AttendanceRule,
  leaveTypes: z.array(LeaveType).max(30).default([]),
  expensePolicies: z.array(ExpensePolicy).max(30).default([]),
});

export type People = z.output<typeof People>;

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
    issues.push(...expensePolicyIssues(policy, designations, [...path, 'expensePolicies', index]));
  });
  return issues;
}
