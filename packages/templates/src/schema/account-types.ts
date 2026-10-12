import { type AccountType, type AnyField, checkCondition, checkFields } from '@kshetra/forms';
import { type ErrorDetail, issueAt, repeats } from '@kshetra/shared';
import { repeatedKeys } from './organisation';

type Path = readonly PropertyKey[];

// The schemas live in the forms package, beside the fields they carry (decision D43).
export { AccountType, AssignmentSlot, SegmentRule } from '@kshetra/forms';

function checkAccountType(
  type: AccountType,
  typeKeys: ReadonlySet<string>,
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));

  type.parentTypes.forEach((parent, index) => {
    if (!typeKeys.has(parent)) at(['parentTypes', index], `There is no account type \`${parent}\``);
  });
  for (const index of repeats(type.parentTypes)) {
    at(
      ['parentTypes', index],
      `Account type \`${type.parentTypes[index]}\` appears more than once`,
    );
  }

  issues.push(
    ...checkFields(type.fields, { accountTypes: new Map(), linkedAccountTypes: [] }, [
      ...path,
      'fields',
    ]),
  );

  issues.push(...repeatedKeys(type.slots, [...path, 'slots'], 'Slot'));
  const priorities = type.slots.map((slot) => String(slot.priority));
  for (const index of repeats(priorities)) {
    at(['slots', index, 'priority'], `Another slot already has priority ${priorities[index]}`);
  }
  type.slots.forEach((slot, index) => {
    slot.designations.forEach((designation, d) => {
      if (!designations.has(designation)) {
        at(['slots', index, 'designations', d], `There is no designation \`${designation}\``);
      }
    });
  });

  const fields = new Map<string, AnyField>(type.fields.map((field) => [field.key, field]));
  const segments = type.segmentRules.map((rule) => rule.segment);
  for (const index of repeats(segments)) {
    at(['segmentRules', index, 'segment'], `Segment \`${segments[index]}\` appears more than once`);
  }
  type.segmentRules.forEach((rule, index) => {
    issues.push(
      ...checkCondition(
        rule.when,
        fields,
        [...path, 'segmentRules', index, 'when'],
        (key) => `Account type \`${type.key}\` has no field \`${key}\``,
      ),
    );
  });

  const normed = type.visitFrequencyNorms.map((norm) => norm.segment);
  normed.forEach((segment, index) => {
    if (!segments.includes(segment)) {
      at(['visitFrequencyNorms', index, 'segment'], `No segment rule tags \`${segment}\``);
    }
  });
  for (const index of repeats(normed)) {
    at(
      ['visitFrequencyNorms', index, 'segment'],
      `Segment \`${normed[index]}\` appears more than once`,
    );
  }
  return issues;
}

/** Checks account types beyond their shape: references, slots, segments and fields. */
export function checkAccountTypes(
  types: readonly AccountType[],
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const typeKeys = new Set(types.map((type) => type.key));
  return [
    ...repeatedKeys(types, path, 'Account type'),
    ...types.flatMap((type, index) =>
      checkAccountType(type, typeKeys, designations, [...path, index]),
    ),
  ];
}
