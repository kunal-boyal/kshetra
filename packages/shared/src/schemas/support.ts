import { z } from 'zod';
import {
  SUPPORT_DEFAULT_HOURS,
  SUPPORT_MAX_HOURS,
  SUPPORT_SCOPES,
  SUPPORT_STATUSES,
} from '../support';

/** Support access grants (module M22, decision D93), as the console and the portal see them. */

export const SupportScope = z.enum(SUPPORT_SCOPES);
export const SupportStatus = z.enum(SUPPORT_STATUSES);

/** `POST /platform/v1/support-grants`: a staff member asks to enter a tenant. */
export const SupportRequestBody = z
  .strictObject({
    tenantId: z.uuid(),
    /** Why, as the tenant's admin will read it. */
    reason: z.string().trim().min(10).max(500),
    scope: SupportScope.default('read'),
    hours: z.int().min(1).max(SUPPORT_MAX_HOURS).default(SUPPORT_DEFAULT_HOURS),
    /** Approved by a second vendor admin rather than the tenant's admin; reads only. */
    emergency: z.boolean().default(false),
  })
  .meta({ id: 'SupportRequestBody' });

/** `POST /v1/support-grants/{id}/decision`: the tenant's admin approves, perhaps narrower, or declines. */
export const SupportDecisionBody = z
  .strictObject({
    approve: z.boolean(),
    /** On approval: the scope and hours granted, no more than asked; left out, as asked. */
    scope: SupportScope.optional(),
    hours: z.int().min(1).max(SUPPORT_MAX_HOURS).optional(),
  })
  .meta({ id: 'SupportDecisionBody' });

/** Who decided or ended a grant: someone at the tenant, or vendor staff. */
const Decider = z.object({ kind: z.enum(['user', 'staff']), name: z.string() }).nullable();

export const SupportGrantResult = z
  .object({
    id: z.uuid(),
    tenant: z.object({ id: z.uuid(), name: z.string() }),
    staff: z.object({ id: z.uuid(), name: z.string() }),
    reason: z.string(),
    /** What was asked for. */
    scope: SupportScope,
    hours: z.int(),
    emergency: z.boolean(),
    status: SupportStatus,
    /** What was granted, once approved. */
    grantedScope: SupportScope.nullable(),
    approvedBy: Decider,
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    /** When it was declined or ended early, and by whom. */
    closedAt: z.iso.datetime().nullable(),
    closedBy: Decider,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'SupportGrant' });

export const SupportGrantList = z.object({ items: z.array(SupportGrantResult) });

/** `GET /platform/v1/support-grants`: by tenant, by status, or the caller's own. */
export const SupportGrantQuery = z.object({
  tenantId: z.uuid().optional(),
  status: SupportStatus.optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** `POST /platform/v1/support-grants/{id}/enter`: where the staff member's browser goes next. */
export const SupportEntryResult = z.object({
  /** Works once, for a minute; it opens the tenant's portal under the grant. */
  url: z.string(),
});

/** `GET /auth/v1/support/enter`: the one-time code an entry link carries. */
export const SupportEntryQuery = z.strictObject({ code: z.string().min(20).max(200) });

/** A support session, as `GET /v1/me` describes it to the portal. */
export const SupportSession = z.object({
  grantId: z.uuid(),
  staffName: z.string(),
  scope: SupportScope,
  endsAt: z.iso.datetime(),
});

export type SupportRequestBody = z.output<typeof SupportRequestBody>;
export type SupportDecisionBody = z.output<typeof SupportDecisionBody>;
export type SupportGrantResult = z.infer<typeof SupportGrantResult>;
export type SupportGrantQuery = z.output<typeof SupportGrantQuery>;
export type SupportSession = z.infer<typeof SupportSession>;
