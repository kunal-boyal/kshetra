import { z } from 'zod';
import { USAGE_METRICS } from '../billing';
import { MODULE_KEYS, SWITCHABLE_MODULES } from '../modules';
import { Key, LocalizedText, Money } from './config';

/**
 * Plans, entitlements and usage in the platform console (modules M22 and M23, decision D89).
 * Prices are per seat; a plan's modules are what its tenants may use (spec 5.13).
 */

/** Each limit's allowed values; the schemas below take them from here. */
const limit = {
  users: () => z.int().min(1).max(1_000_000),
  storageGb: () => z.int().min(1).max(1_000_000),
  apiPerMinute: () => z.int().min(1).max(100_000),
  requestsPerMinute: () => z.int().min(60).max(1_000_000),
  queueSlots: () => z.int().min(1).max(20),
  importRows: () => z.int().min(100).max(200_000),
  exportRows: () => z.int().min(1_000).max(1_000_000),
};

/** The limits a plan can set, in the order the console shows them. */
export const PLAN_LIMIT_KEYS = Object.keys(limit) as (keyof typeof limit)[];
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];
/** Every limit's value in force, null where open or keeping its default. */
export type PlanLimitValues = Record<PlanLimitKey, number | null>;

/** What a plan caps; null leaves it open, or for some keeps a default. */
export const PlanLimits = z.strictObject({
  /** People who may be active at once (BR-45); past it, adding someone answers SEAT_LIMIT. */
  users: limit.users().nullable().default(null),
  storageGb: limit.storageGb().nullable().default(null),
  /** Requests a minute each API client may make (decision D94); null keeps the default. */
  apiPerMinute: limit.apiPerMinute().nullable().default(null),
  /**
   * Requests a minute the whole tenant may make, people and API clients together (spec 10.3,
   * decision D98); null leaves it open.
   */
  requestsPerMinute: limit.requestsPerMinute().nullable().default(null),
  /** Heavy jobs (imports, exports, recomputes) the tenant may run at once; null keeps 2. */
  queueSlots: limit.queueSlots().nullable().default(null),
  /** Rows one import may hold; null keeps 20,000. */
  importRows: limit.importRows().nullable().default(null),
  /** Rows one export may hold; null keeps 100,000. */
  exportRows: limit.exportRows().nullable().default(null),
});

/** Every limit, null where open. */
const LimitsInForce = z.object({
  users: z.int().nullable(),
  storageGb: z.int().nullable(),
  apiPerMinute: z.int().nullable(),
  requestsPerMinute: z.int().nullable(),
  queueSlots: z.int().nullable(),
  importRows: z.int().nullable(),
  exportRows: z.int().nullable(),
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
    limits: PlanLimits.default({
      users: null,
      storageGb: null,
      apiPerMinute: null,
      requestsPerMinute: null,
      queueSlots: null,
      importRows: null,
      exportRows: null,
    }),
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
    limits: LimitsInForce,
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
      users: limit.users().nullable().optional(),
      storageGb: limit.storageGb().nullable().optional(),
      apiPerMinute: limit.apiPerMinute().nullable().optional(),
      requestsPerMinute: limit.requestsPerMinute().nullable().optional(),
      queueSlots: limit.queueSlots().nullable().optional(),
      importRows: limit.importRows().nullable().optional(),
      exportRows: limit.exportRows().nullable().optional(),
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
    limits: LimitsInForce,
    /** Limits set for this tenant alone; a missing key follows the plan, null lifts the cap. */
    ownLimits: LimitsInForce.partial(),
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
