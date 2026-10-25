import { z } from 'zod';
import { USAGE_METRICS } from '../billing';
import { MODULE_KEYS, SWITCHABLE_MODULES } from '../modules';
import { Key, LocalizedText, Money } from './config';

/**
 * Plans, entitlements and usage in the platform console (modules M22 and M23, decision D89).
 * Prices are per seat; a plan's modules are what its tenants may use (spec 5.13).
 */

/** What a plan caps; null leaves it open. */
export const PlanLimits = z.strictObject({
  /** People who may be active at once (BR-45); past it, adding someone answers SEAT_LIMIT. */
  users: z.int().min(1).max(1_000_000).nullable().default(null),
  storageGb: z.int().min(1).max(1_000_000).nullable().default(null),
});

export const PlanAddon = z.strictObject({
  key: Key,
  name: LocalizedText,
  /** Per month, as the add-on's own unit says (spec 1.3: SMS, WhatsApp, storage, modules). */
  price: Money,
});

export const PlanBody = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    /** Per seat per month on a monthly plan. */
    priceMonth: Money,
    /** Per seat per year on an annual plan. */
    priceYear: Money,
    modules: z
      .array(z.enum(MODULE_KEYS))
      .refine((modules) => modules.includes('core'), 'Every plan includes core')
      .refine((modules) => new Set(modules).size === modules.length, 'List each module once'),
    limits: PlanLimits.default({ users: null, storageGb: null }),
    addons: z.array(PlanAddon).max(20).default([]),
    active: z.boolean().default(true),
  })
  .meta({ id: 'PlanBody' });

/** `POST /platform/v1/plans`: the console names the plan, so a create sent twice makes one. */
export const CreatePlanBody = PlanBody.extend({ id: z.uuid() });

export const PlanResult = z
  .object({
    id: z.uuid(),
    key: Key,
    name: LocalizedText,
    priceMonth: z.string(),
    priceYear: z.string(),
    modules: z.array(z.enum(MODULE_KEYS)),
    limits: z.object({ users: z.int().nullable(), storageGb: z.int().nullable() }),
    addons: z.array(z.object({ key: Key, name: LocalizedText, price: z.string() })),
    active: z.boolean(),
    /** Tenants on the plan now. */
    tenants: z.int().min(0),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Plan' });

export const PlanListResult = z.object({ items: z.array(PlanResult) });

export const PlanIdParams = z.strictObject({ id: z.uuid() });

/**
 * `PUT /platform/v1/tenants/{id}/plan`: the tenant's plan, modules beyond it, and limits that
 * differ from it. No plan leaves every module open, as before billing (decision D64).
 */
export const TenantPlanBody = z.strictObject({
  planId: z.uuid().nullable(),
  extraModules: z.array(z.enum(SWITCHABLE_MODULES)).default([]),
  limits: z
    .strictObject({
      users: z.int().min(1).max(1_000_000).nullable().optional(),
      storageGb: z.int().min(1).max(1_000_000).nullable().optional(),
    })
    .default({}),
});

/** What a tenant may use, from its plan and what was added to it. */
export const TenantEntitlements = z
  .object({
    plan: z.object({ id: z.uuid(), key: Key, name: LocalizedText }).nullable(),
    extraModules: z.array(z.enum(SWITCHABLE_MODULES)),
    /** Every module the tenant may switch on; all of them without a plan. */
    modules: z.array(z.enum(MODULE_KEYS)),
    /** The limits in force: the tenant's own where it has them, else the plan's. */
    limits: z.object({ users: z.int().nullable(), storageGb: z.int().nullable() }),
    /** Limits set for this tenant alone; a missing key follows the plan, null lifts the cap. */
    ownLimits: z.object({
      users: z.int().nullable().optional(),
      storageGb: z.int().nullable().optional(),
    }),
  })
  .meta({ id: 'TenantEntitlements' });

export const UsageQuery = z.strictObject({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

/** A tenant's metered usage by month, newest first (M22). Quantities are decimal strings. */
export const TenantUsageResult = z.object({
  items: z.array(
    z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      metrics: z.partialRecord(z.enum(USAGE_METRICS), z.string()),
      updatedAt: z.iso.datetime(),
    }),
  ),
});

export type PlanBody = z.output<typeof PlanBody>;
export type CreatePlanBody = z.output<typeof CreatePlanBody>;
export type PlanResult = z.infer<typeof PlanResult>;
export type TenantPlanBody = z.output<typeof TenantPlanBody>;
export type TenantEntitlements = z.infer<typeof TenantEntitlements>;
export type TenantUsageResult = z.infer<typeof TenantUsageResult>;
