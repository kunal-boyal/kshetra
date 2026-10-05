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
