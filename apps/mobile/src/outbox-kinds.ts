import type { OutboxItem, OutboxSender } from '@kshetra/api-client/sync';
import type { MessageKey } from '@kshetra/i18n';
import {
  AccountResult,
  type CreateAccountBody,
  type CreateLocationProposalBody,
  LocationProposalResult,
} from '@kshetra/shared';
import type { MobileClient } from './client';

/** A proposed location, with the account it is for. */
export interface LocationProposalPayload extends CreateLocationProposalBody {
  accountId: string;
}

/**
 * How each kind of captured record uploads, and its name in the upload queue. Each sends the
 * record's own ID, so an upload sent twice is applied once (BR-46). Shifts, visits, submissions,
 * photos and orders add their kinds as their modules arrive (phase 1).
 */
export function senders(
  client: Pick<MobileClient, 'request'>,
): Readonly<Record<string, OutboxSender>> {
  return {
    'account.propose': {
      async send(payload) {
        await client.request('POST', '/v1/accounts', AccountResult, {
          body: payload as CreateAccountBody,
        });
      },
    },
    'account.location': {
      async send(payload) {
        const { accountId, ...body } = payload as LocationProposalPayload;
        await client.request(
          'POST',
          `/v1/accounts/${accountId}/location-proposals`,
          LocationProposalResult,
          { body },
        );
      },
    },
  };
}

const LABELS: Readonly<Record<string, MessageKey>> = {
  'account.propose': 'uploads.kind_account_propose',
  'account.location': 'uploads.kind_account_location',
};

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** What the upload queue calls an item. */
export function itemLabel(item: OutboxItem, t: Translate): string {
  const label = LABELS[item.kind];
  return label ? t(label) : t('uploads.item', { kind: item.kind });
}
