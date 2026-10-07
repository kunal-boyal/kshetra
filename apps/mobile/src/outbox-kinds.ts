import type { OutboxItem, OutboxSender } from '@kshetra/api-client/sync';
import type { MessageKey } from '@kshetra/i18n';

/**
 * How each kind of captured record uploads, and its name in the upload queue. Shifts, visits,
 * submissions, photos and orders add their kinds as their modules arrive (phase 1).
 */
export const SENDERS: Readonly<Record<string, OutboxSender>> = {};

const LABELS: Readonly<Record<string, MessageKey>> = {};

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** What the upload queue calls an item. */
export function itemLabel(item: OutboxItem, t: Translate): string {
  const label = LABELS[item.kind];
  return label ? t(label) : t('uploads.item', { kind: item.kind });
}
