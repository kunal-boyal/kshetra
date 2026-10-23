/**
 * Order rules (BR-19, spec 5.11) as pure functions: the server applies them, the apps preview.
 */
import { scaled, unscaled } from './pricing';

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

export const LINE_DECISIONS = ['pending', 'accepted', 'rejected'] as const;
export type LineDecision = (typeof LINE_DECISIONS)[number];

/**
 * Reasons for rejecting orders and lines when the tenant's catalogue names none (spec 5.11).
 */
export const DEFAULT_REJECTION_REASONS = [
  { key: 'overdue', name: { en: 'Overdue', hi: 'बकाया' } },
  { key: 'credit_limit', name: { en: 'Credit limit exceeded', hi: 'उधार सीमा पार' } },
  { key: 'no_stock', name: { en: 'No stock', hi: 'स्टॉक नहीं' } },
] as const;

/** Who supplies an order: the company (a primary order) or the account's parent (secondary). */
export const SUPPLIER_KINDS = ['company', 'account'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

/**
 * BR-19: an order's status once its chain approves it, from its lines' decisions. A line nobody
 * decided was accepted with the order: all accepted, `accepted`; none, `rejected`; else
 * `partially_accepted`.
 */
export function statusFromLines(decisions: readonly LineDecision[]): OrderStatus {
  const accepted = decisions.filter((decision) => decision !== 'rejected').length;
  if (accepted === decisions.length) return 'accepted';
  return accepted === 0 ? 'rejected' : 'partially_accepted';
}

/**
 * BR-19: the status fulfilment leaves an order in, given base units ordered and fulfilled on each
 * accepted line, or null when the order can't be fulfilled now. Fulfilling nothing yet keeps the
 * status; every accepted line in full makes it `fulfilled`.
 */
export function statusAfterFulfilment(
  status: OrderStatus,
  lines: readonly { ordered: string; fulfilled: string }[],
): OrderStatus | null {
  if (!['accepted', 'partially_accepted', 'partially_fulfilled'].includes(status)) return null;
  const some = lines.some((line) => scaled(line.fulfilled, 3) > 0n);
  if (!some) return status;
  const all = lines.every((line) => scaled(line.fulfilled, 3) >= scaled(line.ordered, 3));
  return all ? 'fulfilled' : 'partially_fulfilled';
}

/** BR-19: whether an order in this status may still be cancelled by back office. */
export function cancellable(status: OrderStatus): boolean {
  return status === 'accepted' || status === 'partially_accepted';
}

/**
 * GST within the state (decision D73): the item's one rate shown as equal CGST and SGST halves.
 * The halves always add up to the tax: CGST takes the rounded half, SGST the rest.
 */
export function gstHalves(tax: string): { cgst: string; sgst: string } {
  const total = scaled(tax, 2);
  const cgst = (total + 1n) / 2n;
  return { cgst: unscaled(cgst, 2), sgst: unscaled(total - cgst, 2) };
}
