import type { OutboxItem, OutboxSender } from '@thelamp/api-client/sync';
import type { MessageKey } from '@thelamp/i18n';
import {
  AccountResult,
  type CheckOutBody,
  type CreateAccountBody,
  type CreateExpenseClaimBody,
  type CreateLeaveRequestBody,
  type CreatePlanItemBody,
  type CreateRegularisationBody,
  type CreateSubmissionBody,
  type CreateLocationProposalBody,
  OrderResult,
  type PlaceOrderBody,
  type EndShiftBody,
  ExpenseClaimResult,
  LeaveRequestResult,
  LocationProposalResult,
  PlanItemResult,
  RegularisationResult,
  type PauseShiftBody,
  type ResumeShiftBody,
  ShiftResult,
  type StartShiftBody,
  type StartVisitBody,
  SubmissionResult,
  VisitResult,
} from '@thelamp/shared';
import type { MobileClient } from './client';
import type { ReceiptsPayload } from './expenses';
import { photoSender } from './photos';

/** A proposed location, with the account it is for. */
export interface LocationProposalPayload extends CreateLocationProposalBody {
  accountId: string;
}

/**
 * How each kind of captured record uploads, and its name in the upload queue. Each sends the
 * record's own ID, so an upload sent twice is applied once (BR-46).
 */
export function senders(
  client: Pick<MobileClient, 'request'>,
  /** Uploads a person's waiting location points, which a claim's tracked distance counts. */
  flushPoints: (owner: string) => Promise<void> = async () => {},
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
    // Visits and submissions (M6): a check-in after its punch-in, a submission after its photos
    // and its visit's check-in.
    'visit.check_in': {
      async send(payload) {
        await client.request('POST', '/v1/visits', VisitResult, {
          body: payload as StartVisitBody,
        });
      },
    },
    'visit.check_out': {
      async send(payload) {
        const { visitId, ...body } = payload as CheckOutBody & { visitId: string };
        await client.request('POST', `/v1/visits/${visitId}/check-out`, VisitResult, { body });
      },
    },
    'plan_item.create': {
      async send(payload) {
        await client.request('POST', '/v1/plan-items', PlanItemResult, {
          body: payload as CreatePlanItemBody,
        });
      },
    },
    'submission.create': {
      async send(payload) {
        await client.request('POST', '/v1/submissions', SubmissionResult, {
          body: payload as CreateSubmissionBody,
        });
      },
    },
    // Orders (M10): after the visit they were taken in, if any. The server prices them again.
    'order.place': {
      async send(payload) {
        await client.request('POST', '/v1/orders', OrderResult, {
          body: payload as PlaceOrderBody,
        });
      },
    },
    // Fixing a day (M13): the server applies a request sent twice once.
    'regularisation.create': {
      async send(payload) {
        await client.request('POST', '/v1/regularisations', RegularisationResult, {
          body: payload as CreateRegularisationBody,
        });
      },
    },
    // Leave (M13): after its document photo, if any.
    'leave_request.create': {
      async send(payload) {
        await client.request('POST', '/v1/leave-requests', LeaveRequestResult, {
          body: payload as CreateLeaveRequestBody,
        });
      },
    },
    // Expenses (M12): a claim after its photos; receipts for a sent claim after theirs.
    // A claim's day may be paid on tracked distance (D115): its points go first, as the outbox
    // otherwise runs before them.
    'expense_claim.create': {
      async send(payload, item) {
        await flushPoints(item.owner);
        await client.request('POST', '/v1/expense-claims', ExpenseClaimResult, {
          body: payload as CreateExpenseClaimBody,
        });
      },
    },
    'expense_claim.receipts': {
      async send(payload, item) {
        const { claimId, mediaIds } = payload as ReceiptsPayload;
        await client.request('POST', `/v1/expense-claims/${claimId}/receipts`, ExpenseClaimResult, {
          body: { mediaIds },
          idempotencyKey: item.id,
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
  'media.upload': 'uploads.kind_photo',
  'account.propose': 'uploads.kind_account_propose',
  'account.location': 'uploads.kind_account_location',
  'shift.start': 'uploads.kind_shift_start',
  'shift.end': 'uploads.kind_shift_end',
  'shift.pause': 'uploads.kind_shift_pause',
  'shift.resume': 'uploads.kind_shift_resume',
  'visit.check_in': 'uploads.kind_visit_check_in',
  'visit.check_out': 'uploads.kind_visit_check_out',
  'submission.create': 'uploads.kind_submission',
  'plan_item.create': 'uploads.kind_plan_item',
  'order.place': 'uploads.kind_order',
  'regularisation.create': 'uploads.kind_regularisation',
  'leave_request.create': 'uploads.kind_leave',
  'expense_claim.create': 'uploads.kind_expense_claim',
  'expense_claim.receipts': 'uploads.kind_expense_receipts',
};

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** What the upload queue calls an item. */
export function itemLabel(item: OutboxItem, t: Translate): string {
  const label = LABELS[item.kind];
  return label ? t(label) : t('uploads.item', { kind: item.kind });
}
