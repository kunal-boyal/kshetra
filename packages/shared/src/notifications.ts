/**
 * Notifications (M16, decision D58): what each event says, to whom it matters, how it travels,
 * and when it may interrupt. Text lives in the i18n catalogue under `notify.<event>`, rendered in
 * the reader's language; the server keeps the values it was rendered from.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'sms', 'email', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Categories people can mute, unless `mutable` is false (approvals and tracking can't be). */
export const NOTIFICATION_CATEGORIES = [
  'plan',
  'approvals',
  'review',
  'targets',
  'tracking',
  'imports',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const UNMUTABLE_CATEGORIES: readonly NotificationCategory[] = ['approvals', 'tracking'];

export interface NotificationKind {
  category: NotificationCategory;
  /** Channels tried in order after the in-app entry; the first that delivers ends the list. */
  external: readonly ('push' | 'whatsapp' | 'sms' | 'email')[];
  /** Whether it ignores quiet hours. */
  urgent: boolean;
  /** Whether it shows in the in-app inbox. */
  inbox: boolean;
}

/**
 * The events of M16. WhatsApp reaches only people who opted in (spec 13.4), in the provider's
 * approved template for the event and language (spec 5.12, decision D85); without either, the next
 * channel is tried.
 */
export const NOTIFICATION_KINDS = {
  /** Today's plan, at the tenant's plan time: push, then WhatsApp, then SMS (M16). */
  'plan.today': {
    category: 'plan',
    external: ['push', 'whatsapp', 'sms'],
    urgent: false,
    inbox: true,
  },
  /** A request waits for the person's decision: push, then WhatsApp for those who opted in. */
  'approval.waiting': {
    category: 'approvals',
    external: ['push', 'whatsapp'],
    urgent: false,
    inbox: true,
  },
  /** The person's request was decided. */
  'approval.decided': { category: 'approvals', external: ['push'], urgent: false, inbox: true },
  /** A submission of the person's was rejected. */
  'submission.rejected': { category: 'review', external: ['push'], urgent: false, inbox: true },
  /** The person's targets for a month were locked. */
  'target.locked': { category: 'targets', external: [], urgent: false, inbox: true },
  /** No points for 20 minutes during the person's shift. */
  'tracking.stopped': { category: 'tracking', external: ['push'], urgent: true, inbox: true },
  /** Someone the person manages has sent no points for 40 minutes during their shift. */
  'tracking.stopped_report': {
    category: 'tracking',
    external: ['push'],
    urgent: true,
    inbox: true,
  },
  /** An import the person started finished. */
  'import.finished': { category: 'imports', external: ['email'], urgent: false, inbox: true },
  /** An export the person asked for is ready, or failed. */
  'export.finished': { category: 'imports', external: [], urgent: false, inbox: true },
} as const satisfies Record<string, NotificationKind>;

export type NotificationEvent = keyof typeof NOTIFICATION_KINDS;
export const NOTIFICATION_EVENTS = Object.keys(NOTIFICATION_KINDS) as [
  NotificationEvent,
  ...NotificationEvent[],
];

/**
 * The version of the WhatsApp opt-in text (`whatsapp.consent` in the strings). Raise it when the
 * text changes: an opt-in to an earlier version no longer counts, and people are asked again.
 */
export const WHATSAPP_CONSENT_VERSION = 1;

/** Minutes without points before the person hears (spec 12.1), and then their manager. */
export const TRACKING_SILENCE_MINUTES = 20;
export const TRACKING_REPORT_MINUTES = 40;

const minutes = (time: string): number => {
  const [hours, mins] = time.split(':').map(Number) as [number, number];
  return hours * 60 + mins;
};

/** Whether a time of day (`HH:MM`) falls inside quiet hours, which may run past midnight. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  const now = minutes(time);
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** How many minutes from a time of day until quiet hours end; 0 outside them. */
export function minutesUntilQuietEnds(time: string, start: string, end: string): number {
  if (!inQuietHours(time, start, end)) return 0;
  return (minutes(end) - minutes(time) + 24 * 60) % (24 * 60);
}

/** Whether the person may mute a category. */
export function mutable(category: NotificationCategory): boolean {
  return !UNMUTABLE_CATEGORIES.includes(category);
}

/** SMS segments a message takes: 160 GSM characters, or 70 for Unicode such as Hindi. */
export function smsSegments(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\u0000-\u007f]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
