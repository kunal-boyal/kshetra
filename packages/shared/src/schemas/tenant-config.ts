import { type CountryCode, isSupportedCountry } from 'libphonenumber-js';
import { z } from 'zod';
import { DataScope, Permission } from './common';
import { contrastRatio, HEX_COLOUR } from '../colour';
import { bucketsIssue, DEFAULT_AGEING_BUCKETS } from '../finance';
import { SWITCHABLE_MODULES } from '../modules';
import { RAW_LOCATION_RETENTION_DAYS_MAX, SYNC_WINDOW_HOURS_MAX } from '../retention';
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
  // Hermes, on the Android app, has no `supportedValuesOf`; the server checks, and phones trust it.
  .refine(
    (code) =>
      typeof Intl.supportedValuesOf !== 'function' ||
      Intl.supportedValuesOf('currency').includes(code),
    'This currency is unknown',
  );

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

/** India's GSTIN: state code, PAN, entity number, Z, check character (spec 5.1). */
const Gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    'Use a 15-character GSTIN, such as 07ABCDE1234F1Z5',
  );

/** A Google Maps JavaScript API key: browser keys are public, limited by website (decision D64). */
const MapsKey = z
  .string()
  .trim()
  .regex(/^AIza[0-9A-Za-z_-]{35}$/, 'Use a Google Maps API key');

/** A time of day on the tenant's clock, `HH:MM`. */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Write the time as 08:00')
  .meta({ id: 'TimeOfDay' });

/** The settings of spec 5.1. Every one has a default in `SETTING_DEFAULTS`. */
export const TenantSettings = z.strictObject({
  /** Legal details print on PDFs and exports (spec 5.1); the display name is the directory's. */
  legalName: z.string().trim().min(1).max(200).nullable(),
  address: z.string().trim().min(1).max(500).nullable(),
  taxId: Gstin.nullable(),
  /** The logo's stored file; set through `PUT /v1/organisation/logo`, never directly. */
  logoMediaId: z.uuid().nullable(),
  /** The tenant's own key for maps on the web; null uses the vendor's (decision D60). */
  mapsWebKey: MapsKey.nullable(),
  /** Modules the tenant switched off (spec 5.13); Core never is. */
  modulesOff: z
    .array(z.enum(SWITCHABLE_MODULES))
    .refine((list) => new Set(list).size === list.length, 'List each module once'),
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
  syncWindowHours: range(24, SYNC_WINDOW_HOURS_MAX),
  maxShiftHours: range(8, 24),
  attendanceSelfie: z.boolean(),
  /** Odometer readings with a photo at punch-in and punch-out (decision D99). */
  odometer: z.enum(['off', 'optional', 'required']),
  deviceBinding: z.boolean().meta({
    description: 'One phone per user until a manager or an admin resets it (BR-38)',
  }),
  rawLocationRetentionDays: range(7, RAW_LOCATION_RETENTION_DAYS_MAX),
  trailRetentionDays: range(90, 1095),
  evidencePhotoRetentionMonths: range(3, 60),
  /** How long notifications and their deliveries are kept (M21, decision D95). */
  notificationRetentionDays: range(30, 365),
  /** How long uploaded import files are kept; the import's record stays. */
  importFileRetentionDays: range(7, 180),
  /** How long the audit log is kept (D9). */
  auditRetentionYears: range(1, 7),
  reviewAutoApproval: z.boolean(),
  /** A person's month of plan items waits for their manager's approval before it counts (M8). */
  journeyPlanApproval: z.boolean(),
  targetUnlockByAdmin: z.boolean(),
  ordersNeedOpenShift: z.boolean(),
  ordersAllowedOffline: z.boolean(),
  /** Days past due that account finance ages outstanding into (M11, BR-20). */
  ageingBuckets: z
    .array(
      z.strictObject({
        key: Key,
        fromDays: z.int().min(0).max(3650),
        toDays: z.int().min(0).max(3650).nullable(),
      }),
    )
    .min(1)
    .max(8)
    .superRefine((buckets, context) => {
      const issue = bucketsIssue(buckets);
      if (issue) context.addIssue({ code: 'custom', message: issue });
    }),
  /** When field users hear about today's plan, on the tenant's clock (M16). */
  planNotificationTime: TimeOfDay,
  /** Non-urgent push and SMS wait from here until `quietHoursEnd` (M16). */
  quietHoursStart: TimeOfDay,
  quietHoursEnd: TimeOfDay,
});

export type TenantSettings = z.output<typeof TenantSettings>;

/** The defaults of spec 5.1, which a tenant has until it changes them. */
export const SETTING_DEFAULTS: TenantSettings = {
  legalName: null,
  address: null,
  taxId: null,
  logoMediaId: null,
  mapsWebKey: null,
  modulesOff: [],
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
  odometer: 'off',
  deviceBinding: true,
  rawLocationRetentionDays: 35,
  trailRetentionDays: 365,
  evidencePhotoRetentionMonths: 12,
  notificationRetentionDays: 90,
  importFileRetentionDays: 30,
  auditRetentionYears: 3,
  reviewAutoApproval: false,
  journeyPlanApproval: false,
  targetUnlockByAdmin: false,
  ordersNeedOpenShift: false,
  ordersAllowedOffline: true,
  ageingBuckets: DEFAULT_AGEING_BUCKETS.map((bucket) => ({ ...bucket })),
  planNotificationTime: '08:00',
  quietHoursStart: '21:00',
  quietHoursEnd: '07:00',
};

/**
 * Stored settings with the defaults filled in. Stores keep only what a tenant changed, so a
 * setting added later reaches every tenant with its default.
 */
export function withDefaults(stored: Partial<TenantSettings>): TenantSettings {
  return TenantSettings.parse({ ...SETTING_DEFAULTS, ...stored });
}

/**
 * The settings a configuration file carries (M2, decision D66): the working rules. The tenant's
 * identity and secrets stay behind: its names, address, GSTIN, logo, brand colour and Maps key.
 */
export const PortableSettings = TenantSettings.omit({
  legalName: true,
  address: true,
  taxId: true,
  logoMediaId: true,
  mapsWebKey: true,
  brandColour: true,
})
  .partial()
  .meta({ id: 'PortableSettings' });

export type PortableSettings = z.output<typeof PortableSettings>;

/** `PATCH /v1/settings`: send only what changes. */
export const UpdateSettingsBody = TenantSettings.omit({ logoMediaId: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one setting to change');

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

/**
 * Settings as the apps read them from the bundle. A setting a newer server added is dropped and one
 * it lacks takes its default, so an app already on a phone keeps working when settings are added
 * (spec 14.3: settings only ever grow). Changes stay strict: `UpdateSettingsBody`.
 */
export const BundleSettings = z.preprocess(
  (value) =>
    value !== null && typeof value === 'object' ? { ...SETTING_DEFAULTS, ...value } : value,
  z.object(TenantSettings.shape),
);

/** The bundle's core; `ConfigBundle` in `@thelamp/forms` adds the configuration with fields. */
export const CoreConfigBundle = z.object({
  /** Moves on with every change to anything here; the ETag carries it (spec 11.3). */
  version: z.int().min(0),
  settings: BundleSettings,
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

/** The largest logo accepted, before it is resized (decision D64). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Logo files the server takes; SVG is refused, as it can carry script. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** `GET /v1/organisation`: the display name, and a short-lived link to the logo. */
export const OrganisationResult = z
  .object({
    name: z.string(),
    logo: z.object({ url: z.string(), expiresAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'OrganisationResult' });

/** `PATCH /v1/organisation`: a new display name. */
export const UpdateOrganisationBody = z.strictObject({
  name: z.string().trim().min(2).max(120),
});

export type OrganisationResult = z.infer<typeof OrganisationResult>;
export type UpdateOrganisationBody = z.output<typeof UpdateOrganisationBody>;
