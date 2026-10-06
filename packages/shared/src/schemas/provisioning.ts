import { z } from 'zod';
import { PhoneInput } from './auth';
import { Key } from './config';
import { UserCode } from './iam';

/**
 * Creating a tenant from an industry template (spec 5.14, module M22): the provisioning command
 * now, and the platform console from phase 3.
 */

/** The tenant's short name in the directory: lowercase letters, digits and hyphens. */
export const TenantSlug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{2,39}$/, 'Use 3 to 40 lowercase letters, digits or hyphens');

export const ProvisionTenantInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: TenantSlug,
  template: Key,
  /** How the tenant opens once it is ready. */
  status: z.enum(['trial', 'active']).default('trial'),
  /** The first admin, who signs in and invites everyone else (onboarding, spec 15). */
  admin: z.strictObject({
    code: UserCode.default('ADMIN-1'),
    name: z.string().trim().min(2).max(100),
    phone: PhoneInput,
    email: z.email().max(254).optional(),
  }),
});

export type ProvisionTenantInput = z.output<typeof ProvisionTenantInput>;
