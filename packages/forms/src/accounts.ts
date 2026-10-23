import { type ErrorDetail, issueAt } from '@thelamp/shared';
import type { AccountType } from './account-types';
import { conditionHolds, type Values } from './values';

/**
 * Account rules (spec 5.5, M4) as pure functions: the server applies them, and the apps call them
 * only to preview.
 */

/** The segments an account's values tag it with, in the order of the type's rules. */
export function accountSegments(type: Pick<AccountType, 'segmentRules'>, values: Values): string[] {
  return type.segmentRules
    .filter((rule) => conditionHolds(rule.when, values))
    .map((rule) => rule.segment);
}

/** Who fills one slot of an account, with their designation, as the rules need them. */
export interface SlotHolder {
  slot: string;
  userId: string;
  designation: string;
}

/**
 * Checks who fills an account's slots: each slot is the type's, holds one person, and allows that
 * person's designation. With `complete`, every required slot must be filled, as for an account
 * becoming active; a proposal from the field may leave them to its approver. Problems sit at
 * `slots.<key>`.
 */
export function checkSlots(
  type: Pick<AccountType, 'slots'>,
  holders: readonly SlotHolder[],
  options: { complete: boolean },
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const slots = new Map(type.slots.map((slot) => [slot.key, slot]));
  const seen = new Set<string>();
  for (const holder of holders) {
    const slot = slots.get(holder.slot);
    if (!slot) {
      issues.push(issueAt(['slots', holder.slot], 'This type of account has no such slot'));
      continue;
    }
    if (seen.has(holder.slot)) {
      issues.push(issueAt(['slots', holder.slot], 'A slot holds one person'));
      continue;
    }
    seen.add(holder.slot);
    if (!slot.designations.includes(holder.designation)) {
      issues.push(
        issueAt(['slots', holder.slot], "This person's designation can't fill this slot"),
      );
    }
  }
  if (options.complete) {
    for (const slot of type.slots) {
      if (slot.required && !seen.has(slot.key)) {
        issues.push(issueAt(['slots', slot.key], 'Choose someone for this slot'));
      }
    }
  }
  return issues;
}

/** The primary assignee: whoever fills the highest-priority filled slot (1 is the highest). */
export function primaryAssignee<Holder extends Pick<SlotHolder, 'slot'>>(
  type: Pick<AccountType, 'slots'>,
  holders: readonly Holder[],
): Holder | null {
  const priority = new Map(type.slots.map((slot) => [slot.key, slot.priority]));
  let best: Holder | null = null;
  for (const holder of holders) {
    const rank = priority.get(holder.slot);
    if (rank === undefined) continue;
    if (best === null || rank < priority.get(best.slot)!) best = holder;
  }
  return best;
}
