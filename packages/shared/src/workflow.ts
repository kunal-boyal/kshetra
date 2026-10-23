/**
 * The request types that approval chains route (spec 5.9). Each tenant has at most one workflow
 * definition per type.
 */
export const REQUEST_TYPES = [
  'leave',
  'regularisation',
  'expense',
  'order',
  'new_account',
  'account_location_change',
  'journey_plan',
  'target_lock',
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

/** Request types about one account, so a step can route to the user in one of its slots. */
export const ACCOUNT_REQUEST_TYPES = [
  'order',
  'new_account',
  'account_location_change',
] as const satisfies readonly RequestType[];

/** Why a step of a chain was passed over when a request started (BR-31). */
export const SKIP_REASONS = ['condition', 'no_approver', 'requester', 'repeated'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** One step of a chain as the resolvers found it for a request, before BR-31 routes it. */
export interface ResolvedStep {
  /** False when the step's condition doesn't hold for the request's facts. */
  applies: boolean;
  /** The active people the step's resolver found, nearest first. */
  approvers: readonly string[];
  /**
   * The active holders of the role the step escalates to when nobody resolves, or undefined when
   * the step is skipped instead.
   */
  escalateTo?: readonly string[];
}

export interface RoutedStep {
  approvers: string[];
  /** `pending` for the step waiting now, `waiting` for later steps, `skipped` for passed ones. */
  status: 'pending' | 'waiting' | 'skipped';
  skipReason: SkipReason | null;
  /** Whether nobody resolved and the step went to its escalation role. */
  escalated: boolean;
  /** The tenant's fallback approvers, added because no step of the chain remained. */
  fallback: boolean;
}

/**
 * Routes a new request through its chain (BR-31):
 * - a step whose condition doesn't hold is skipped;
 * - a step with nobody to decide goes to its escalation role, or is skipped without one;
 * - the requester never decides their own request, so a step only they would decide is skipped;
 * - when consecutive remaining steps go to the same people, the earlier is skipped, so nobody
 *   approves a request twice in a row;
 * - the first remaining step waits for a decision; when none remains, the tenant's fallback
 *   approvers decide, as a step added at the end.
 * Returns null when not even a fallback approver remains.
 */
export function routeRequest(
  steps: readonly ResolvedStep[],
  requesterId: string,
  fallback: readonly string[],
): RoutedStep[] | null {
  const routed: RoutedStep[] = steps.map((step) => {
    const skip = (skipReason: SkipReason): RoutedStep => ({
      approvers: [],
      status: 'skipped',
      skipReason,
      escalated: false,
      fallback: false,
    });
    if (!step.applies) return skip('condition');
    let approvers = [...new Set(step.approvers)];
    let escalated = false;
    if (approvers.length === 0 && step.escalateTo) {
      approvers = [...new Set(step.escalateTo)];
      escalated = true;
    }
    if (approvers.length === 0) return skip('no_approver');
    const others = approvers.filter((id) => id !== requesterId);
    if (others.length === 0) return skip('requester');
    return { approvers: others, status: 'waiting', skipReason: null, escalated, fallback: false };
  });
  const remaining = routed.filter((step) => step.status !== 'skipped');
  for (let i = 0; i < remaining.length - 1; i += 1) {
    if (sameSet(remaining[i]!.approvers, remaining[i + 1]!.approvers)) {
      Object.assign(remaining[i]!, { approvers: [], status: 'skipped', skipReason: 'repeated' });
    }
  }
  const first = routed.find((step) => step.status === 'waiting');
  if (first) {
    first.status = 'pending';
    return routed;
  }
  const others = [...new Set(fallback)].filter((id) => id !== requesterId);
  if (others.length === 0) return null;
  return [
    ...routed,
    { approvers: others, status: 'pending', skipReason: null, escalated: false, fallback: true },
  ];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The step after `index` still waiting, which becomes current once `index` is approved. */
export function nextStep(steps: readonly { status: string }[], index: number): number | null {
  for (let i = index + 1; i < steps.length; i += 1) {
    if (steps[i]!.status === 'waiting') return i;
  }
  return null;
}
