import { type ErrorDetail, issueAt } from './errors';

/**
 * Approval delegation (M15, phase 4 step B1, decision D113): an approver away names a delegate
 * for some days of the tenant's calendar; while one covers a day, what waits for the approver
 * waits for the delegate too.
 */

/** The longest a delegation may run, in days counted from its first to its last. */
export const DELEGATION_MAX_DAYS = 90;

/** A delegation's days and whether it was ended early, as the rules need them. */
export interface DelegationDays {
  startsOn: string;
  endsOn: string;
  endedAt: string | null;
}

/** Whether a delegation stands on a day of the tenant's calendar. */
export function delegationActiveOn(delegation: DelegationDays, day: string): boolean {
  return delegation.endedAt === null && delegation.startsOn <= day && day <= delegation.endsOn;
}

/** Whether two delegations share a day; one ended early shares none from then. */
export function delegationsOverlap(a: DelegationDays, b: DelegationDays): boolean {
  if (a.endedAt !== null || b.endedAt !== null) return false;
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Why a delegation can't be made, as field errors: nobody delegates to themselves, the delegate is
 * active and may approve, the days start today or later and end on or after they start within
 * `DELEGATION_MAX_DAYS`, and the delegator has no other delegation over any of them.
 */
export function delegationIssues(input: {
  delegatorId: string;
  delegateId: string;
  startsOn: string;
  endsOn: string;
  today: string;
  delegate: { active: boolean; mayApprove: boolean } | null;
  others: readonly DelegationDays[];
}): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (input.delegateId === input.delegatorId) {
    issues.push(issueAt(['delegateId'], 'Choose someone else to decide for you'));
  } else if (!input.delegate || !input.delegate.active) {
    issues.push(issueAt(['delegateId'], 'Choose someone who works here now'));
  } else if (!input.delegate.mayApprove) {
    issues.push(issueAt(['delegateId'], 'Choose someone who may approve requests'));
  }
  if (input.startsOn < input.today) {
    issues.push(issueAt(['startsOn'], 'Start today or later'));
  }
  if (input.endsOn < input.startsOn) {
    issues.push(issueAt(['endsOn'], 'End on or after the first day'));
  } else if (daysBetween(input.startsOn, input.endsOn) + 1 > DELEGATION_MAX_DAYS) {
    issues.push(issueAt(['endsOn'], `Delegate for ${DELEGATION_MAX_DAYS} days at most`));
  }
  const days = { startsOn: input.startsOn, endsOn: input.endsOn, endedAt: null };
  if (input.others.some((other) => delegationsOverlap(days, other))) {
    issues.push(issueAt(['startsOn'], 'Another delegation covers some of these days'));
  }
  return issues;
}
