import { type CountryCode, isSupportedCountry } from 'libphonenumber-js';
import { z } from 'zod';
import { DataScope, Permission } from './common';
import { contrastRatio, HEX_COLOUR } from '../colour';
import { TERMINOLOGY_KEYS, type TerminologyKey } from '../terminology';
import { Key, LOCALES, LocalizedNoun, localizedText, NounForms } from './config';

/**
 * A tenant's configuration as every app reads it (spec 5.1, 5.2, 11.2): its settings, its words,
 * and what the caller may do. `GET /v1/config` serves it with an ETag.
 */

/** An IANA time zone name as written, such as `Asia/Kolkata`. Offsets like `+05:30` are refused. */
const TimeZone = z
  .string()
  .regex(
    /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z0-9_+-]*){1,2})$/,
    'Use an IANA time zone, such as Asia/Kolkata',
  )
  .refine((name) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: name });
      return true;
    } catch {
      return false;
    }
  }, 'This time zone is unknown');

const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code, such as INR')
  .refine((code) => Intl.supportedValuesOf('currency').includes(code), 'This currency is unknown');

const Country = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Use an ISO 3166 country code, such as IN')
  .refine((code) => isSupportedCountry(code), 'Phone numbers from this country are not supported')
  .transform((code) => code as CountryCode);

/** The tenant's accent. Spec 5.1: it must pass AA contrast (4.5:1) against white. */
const BrandColour = z
  .string()
  .regex(HEX_COLOUR, 'Use a colour such as #5b2b82')
  .transform((hex) => hex.toLowerCase())
  .refine(
    (hex) => contrastRatio(hex, '#ffffff') >= 4.5,
    'Choose a darker colour: white text on it needs a contrast of 4.5:1',
  );

const range = (min: number, max: number) => z.int().min(min).max(max);

/** The settings of spec 5.1. Every one has a default in `SETTING_DEFAULTS`. */
export const TenantSettings = z.strictObject({
  timezone: TimeZone,
  currency: Currency,
  defaultCountry: Country.meta({
    description: 'The country numbers without a country code belong to',
  }),
  languages: z
    .array(z.enum(LOCALES))
    .min(1)
    .refine((list) => list.includes('en'), 'English stays on: missing text falls back to it')
    .refine((list) => new Set(list).size === list.length, 'List each language once'),
  financialYearStartMonth: range(1, 12),
  brandColour: BrandColour.nullable().meta({ description: "Null keeps the product's own accent" }),
  gpsIntervalSeconds: range(30, 900),
  geofenceRadiusMeters: range(50, 5000),
  geofenceAccuracyCapMeters: range(0, 500).meta({
    description: 'The most GPS accuracy that counts toward being inside a geofence (BR-33)',
  }),
  syncWindowHours: range(24, 168),
  maxShiftHours: range(8, 24),
  attendanceSelfie: z.boolean(),
  deviceBinding: z.boolean().meta({
    description: 'One phone per user until a manager or an admin resets it (BR-38)',
  }),
  rawLocationRetentionDays: range(7, 90),
  trailRetentionDays: range(90, 1095),
  evidencePhotoRetentionMonths: range(3, 60),
  reviewAutoApproval: z.boolean(),
  targetUnlockByAdmin: z.boolean(),
  ordersNeedOpenShift: z.boolean(),
  ordersAllowedOffline: z.boolean(),
});

export type TenantSettings = z.output<typeof TenantSettings>;

/** The defaults of spec 5.1, which a tenant has until it changes them. */
export const SETTING_DEFAULTS: TenantSettings = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  defaultCountry: 'IN',
  languages: [...LOCALES],
  financialYearStartMonth: 4,
  brandColour: null,
  gpsIntervalSeconds: 60,
  geofenceRadiusMeters: 300,
  geofenceAccuracyCapMeters: 100,
  syncWindowHours: 72,
  maxShiftHours: 14,
  attendanceSelfie: false,
  deviceBinding: true,
  rawLocationRetentionDays: 35,
  trailRetentionDays: 365,
  evidencePhotoRetentionMonths: 12,
  reviewAutoApproval: false,
  targetUnlockByAdmin: false,
  ordersNeedOpenShift: true,
  ordersAllowedOffline: true,
};

/**
 * Stored settings with the defaults filled in. Stores keep only what a tenant changed, so a
 * setting added later reaches every tenant with its default.
 */
export function withDefaults(stored: Partial<TenantSettings>): TenantSettings {
  return TenantSettings.parse({ ...SETTING_DEFAULTS, ...stored });
}

/** `PATCH /v1/settings`: send only what changes. */
export const UpdateSettingsBody = TenantSettings.partial().refine(
  (body) => Object.keys(body).length > 0,
  'Send at least one setting to change',
);

const TermLabel = localizedText(40);

type TerminologyShape = {
  [K in TerminologyKey]: z.ZodOptional<
    (typeof TERMINOLOGY_KEYS)[K] extends 'noun' ? typeof LocalizedNoun : typeof TermLabel
  >;
};

/**
 * The tenant's own words for the terms of spec 5.2, in every launch language. A template brings
 * its industry's words; a key left out keeps the product default.
 */
export const TerminologyOverrides = z
  .strictObject(
    Object.fromEntries(
      Object.entries(TERMINOLOGY_KEYS).map(([key, kind]) => [
        key,
        (kind === 'noun' ? LocalizedNoun : TermLabel).optional(),
      ]),
    ) as TerminologyShape,
  )
  .meta({ id: 'Terminology' });

/** A term in one language: a noun's two forms, or a label. */
export const TermValue = z.union([NounForms, z.string()]);

/** `GET /v1/terminology`: the tenant's overrides, which `PUT` replaces as a whole. */
export const TerminologyResult = z.object({ overrides: TerminologyOverrides });

/** The bundle's core; `ConfigBundle` in `@kshetra/forms` adds the configuration with fields. */
export const CoreConfigBundle = z.object({
  /** Moves on with every change to anything here; the ETag carries it (spec 11.3). */
  version: z.int().min(0),
  settings: TenantSettings,
  /** Every term resolved for each of the tenant's languages: their word, else the product's. */
  terminology: z.partialRecord(
    z.enum(LOCALES),
    z.record(z.enum(Object.keys(TERMINOLOGY_KEYS) as [TerminologyKey]), TermValue),
  ),
  designations: z.array(
    z.object({ key: Key, name: LocalizedNoun, level: z.int(), ranked: z.boolean() }),
  ),
  /** What the caller may do: their role, its scope and its permissions (spec 4.2). */
  access: z.object({
    role: Key,
    scope: DataScope,
    permissions: z.array(Permission),
  }),
});

export type UpdateSettingsBody = z.output<typeof UpdateSettingsBody>;
export type TerminologyOverrides = z.output<typeof TerminologyOverrides>;
export type TermValue = z.output<typeof TermValue>;
export type TerminologyResult = z.output<typeof TerminologyResult>;
export type CoreConfigBundle = z.output<typeof CoreConfigBundle>;
