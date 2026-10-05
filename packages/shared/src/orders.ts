/** Order statuses (BR-19). */
export const ORDER_STATUSES = [
  'submitted',
  'accepted',
  'partially_accepted',
  'rejected',
  'fulfilled',
  'partially_fulfilled',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
