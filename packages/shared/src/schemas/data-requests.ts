import { z } from 'zod';
import { DATA_REQUEST_KINDS, DATA_REQUEST_STATUSES } from '../data-requests';

/** Personal data requests (module M21, decision D95), as people raise them and admins answer. */

export const DataRequestKind = z.enum(DATA_REQUEST_KINDS);

/** `POST /v1/me/data-requests`: the caller's own request, under the phone's own ID. */
export const RaiseDataRequestBody = z
  .strictObject({
    id: z.uuid(),
    kind: DataRequestKind,
    details: z.string().trim().max(1000).default(''),
  })
  .meta({ id: 'RaiseDataRequestBody' });

/** `POST /v1/data-requests`: an admin logs a request someone made another way. */
export const LogDataRequestBody = RaiseDataRequestBody.extend({ userId: z.uuid() }).meta({
  id: 'LogDataRequestBody',
});

/** `POST /v1/data-requests/{id}/close`: completed, or refused with the reason. */
export const CloseDataRequestBody = z
  .strictObject({
    outcome: z.enum(['completed', 'refused']),
    response: z.string().trim().max(1000).default(''),
  })
  .meta({ id: 'CloseDataRequestBody' });

export const DataRequestQuery = z.strictObject({
  status: z.enum(['open', 'closed', 'all']).default('open'),
});

export const DataRequestResult = z
  .object({
    id: z.uuid(),
    person: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    kind: DataRequestKind,
    status: z.enum(DATA_REQUEST_STATUSES),
    details: z.string(),
    /** What the organisation answered, once it did. */
    response: z.string().nullable(),
    /** Raised by the person themselves, or logged for them by an admin. */
    raisedBy: z.object({ self: z.boolean(), name: z.string() }),
    dueOn: z.iso.date(),
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    closedBy: z.string().nullable(),
    /** An access request's archive of the person's own data, once asked for. */
    archive: z
      .object({
        status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']),
        bytes: z.int().nullable(),
        sha256: z.string().nullable(),
        expiresAt: z.iso.datetime().nullable(),
      })
      .nullable(),
    /** A day's link to the archive, only when one request is read and the archive is kept. */
    download: z.object({ url: z.string(), expiresAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'DataRequest' });

export const DataRequestList = z.object({ items: z.array(DataRequestResult) });

export type RaiseDataRequestBody = z.output<typeof RaiseDataRequestBody>;
export type LogDataRequestBody = z.output<typeof LogDataRequestBody>;
export type CloseDataRequestBody = z.output<typeof CloseDataRequestBody>;
export type DataRequestResult = z.infer<typeof DataRequestResult>;
