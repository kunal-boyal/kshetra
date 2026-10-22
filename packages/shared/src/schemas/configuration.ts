import { z } from 'zod';

/**
 * Configuration export and import (M2, decision D66). The file itself is an industry template, so
 * its schema lives in `@kshetra/templates`; what an import would do is described here, where the
 * web can read it.
 */

/** The parts of a configuration file an import compares, in the order it applies them. */
export const CONFIGURATION_SECTIONS = [
  'settings',
  'terminology',
  'roles',
  'designations',
  'geographyLevels',
  'userFields',
  'accountTypes',
  'catalogue',
  'forms',
  'metrics',
  'score',
  'attendance',
  'imports',
  'workflows',
  'people',
] as const;

/**
 * What an import does to one entry: adds it, updates it, finds it the same, or keeps the
 * tenant's own because a rule forbids the change (such as the tenant admin role's permissions).
 */
export const CONFIGURATION_CHANGES = ['add', 'update', 'same', 'kept'] as const;

/** A problem at its path in the file (spec 11.1). */
const Issue = z.object({ path: z.string(), issue: z.string() });

export const ConfigurationChange = z
  .object({
    section: z.enum(CONFIGURATION_SECTIONS),
    /** The entry's key, or the section's name for a section taken whole. */
    key: z.string(),
    change: z.enum(CONFIGURATION_CHANGES),
  })
  .meta({ id: 'ConfigurationChange' });

/**
 * What an import would do, entry by entry, and every problem that stops it, at its path in the
 * file. Nothing is applied while there are problems.
 */
export const ConfigurationPlan = z
  .object({ changes: z.array(ConfigurationChange), issues: z.array(Issue) })
  .meta({ id: 'ConfigurationPlan' });

export type ConfigurationChange = z.output<typeof ConfigurationChange>;
export type ConfigurationPlan = z.output<typeof ConfigurationPlan>;
