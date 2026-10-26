/**
 * Requests from people about their personal data (module M21, spec 13.3, decision D95): a copy
 * of it (access), a correction, or its erasure where the law allows, logged and answered by the
 * tenant's admins within 30 days. Erasure anonymises the person and keeps the business records.
 */

export const DATA_REQUEST_KINDS = ['access', 'correction', 'erasure'] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

export const DATA_REQUEST_STATUSES = ['received', 'completed', 'refused'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

/** Days the organisation has to answer, and how many before that its admins are reminded. */
export const DATA_REQUEST_DUE_DAYS = 30;
export const DATA_REQUEST_REMINDER_DAYS = 7;

/** The day a request received on `received` (`YYYY-MM-DD`, tenant's calendar) is due. */
export function dataRequestDueOn(received: string): string {
  const day = new Date(`${received}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + DATA_REQUEST_DUE_DAYS);
  return day.toISOString().slice(0, 10);
}

/** Whether today is the day to remind admins of a request due on `dueOn`, or later. */
export function dataRequestReminderDue(dueOn: string, today: string): boolean {
  const remind = new Date(`${dueOn}T00:00:00Z`);
  remind.setUTCDate(remind.getUTCDate() - DATA_REQUEST_REMINDER_DAYS);
  return today >= remind.toISOString().slice(0, 10);
}

/**
 * Why a request can't be raised: someone may have one open request of each kind at a time.
 * Null when it can.
 */
export function dataRequestRaiseIssue(
  kind: DataRequestKind,
  open: readonly DataRequestKind[],
): string | null {
  return open.includes(kind) ? 'An open request of this kind exists already' : null;
}

/**
 * Why a request can't be closed so: refusing says why; an access request completes once its
 * archive is ready; an erasure only for someone already deactivated. Null when it can.
 */
export function dataRequestCloseIssue(input: {
  kind: DataRequestKind;
  status: DataRequestStatus;
  outcome: 'completed' | 'refused';
  response: string;
  archiveReady: boolean;
  personActive: boolean;
}): { path: string; issue: string } | null {
  if (input.status !== 'received')
    return { path: 'outcome', issue: 'The request is closed already' };
  if (input.outcome === 'refused' && input.response.trim().length < 3) {
    return { path: 'response', issue: 'Say why it is refused' };
  }
  if (input.outcome === 'completed' && input.kind === 'access' && !input.archiveReady) {
    return { path: 'outcome', issue: 'Prepare their archive first' };
  }
  if (input.outcome === 'completed' && input.kind === 'erasure' && input.personActive) {
    return { path: 'outcome', issue: 'Deactivate them before erasing their data' };
  }
  return null;
}
