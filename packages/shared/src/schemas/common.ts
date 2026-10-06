import { z } from 'zod';
import { DATA_SCOPES, TENANT_PERMISSIONS } from '../access';

/** A record's ID in a route's path, such as `/v1/users/{id}`. */
export const IdParams = z.strictObject({ id: z.uuid() });

/** `GET /health`: the process is up and answering. */
export const HealthResult = z.object({ status: z.literal('ok') });

/** `GET /ready`: whether everything real work needs answers, check by check. */
export const ReadyResult = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'unavailable'])),
});

/** A tenant permission from spec Appendix E. */
export const Permission = z.enum(TENANT_PERMISSIONS).meta({ id: 'Permission' });

/** Whose records a role reaches (spec 4.2). */
export const DataScope = z.enum(DATA_SCOPES).meta({ id: 'DataScope' });
