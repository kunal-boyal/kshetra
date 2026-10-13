import type { OutboxItem, OutboxSender } from '@kshetra/api-client/sync';
import type { MessageKey } from '@kshetra/i18n';
import {
  AccountResult,
  type CreateAccountBody,
  type CreateLocationProposalBody,
  type EndShiftBody,
  LocationProposalResult,
  type PauseShiftBody,
  type ResumeShiftBody,
  ShiftResult,
  type StartShiftBody,
} from '@kshetra/shared';
import type { MobileClient } from './client';
import { photoSender } from './photos';

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
    'media.upload': photoSender(client),
    'account.propose': {
      async send(payload) {
        await client.request('POST', '/v1/accounts', AccountResult, {
          body: payload as CreateAccountBody,
        });
      },
    },
    // Shifts (M5): the punch-in first; the rest wait for it (`dependsOn`).
    'shift.start': {
      async send(payload) {
        await client.request('POST', '/v1/shifts', ShiftResult, {
          body: payload as StartShiftBody,
        });
      },
    },
    'shift.end': {
      async send(payload) {
        const { shiftId, ...body } = payload as EndShiftBody & { shiftId: string };
        await client.request('POST', `/v1/shifts/${shiftId}/end`, ShiftResult, { body });
      },
    },
    'shift.pause': {
      async send(payload) {
        const { shiftId, ...body } = payload as PauseShiftBody & { shiftId: string };
        await client.request('POST', `/v1/shifts/${shiftId}/pauses`, ShiftResult, { body });
      },
    },
    'shift.resume': {
      async send(payload) {
        const { shiftId, pauseId, ...body } = payload as ResumeShiftBody & {
          shiftId: string;
          pauseId: string;
        };
        await client.request(
          'POST',
          `/v1/shifts/${shiftId}/pauses/${pauseId}/resume`,
          ShiftResult,
          { body },
        );
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
  'media.upload': 'uploads.kind_photo',
  'account.propose': 'uploads.kind_account_propose',
  'account.location': 'uploads.kind_account_location',
  'shift.start': 'uploads.kind_shift_start',
  'shift.end': 'uploads.kind_shift_end',
  'shift.pause': 'uploads.kind_shift_pause',
  'shift.resume': 'uploads.kind_shift_resume',
};

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** What the upload queue calls an item. */
export function itemLabel(item: OutboxItem, t: Translate): string {
  const label = LABELS[item.kind];
  return label ? t(label) : t('uploads.item', { kind: item.kind });
}
