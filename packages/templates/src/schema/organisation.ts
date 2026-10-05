import {
  DATA_SCOPES,
  type ErrorDetail,
  issueAt,
  Key,
  LocalizedNoun,
  LocalizedText,
  repeats,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
} from '@kshetra/shared';
import { z } from 'zod';

type Path = readonly PropertyKey[];

/** Permissions from spec Appendix E, and whose records they reach (spec 4.2). */
export const Role = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    scope: z.enum(DATA_SCOPES),
    permissions: z.array(z.enum(TENANT_PERMISSIONS)).min(1),
    mobileOnly: z.boolean().default(false).meta({
      description: 'Its users may use the mobile app only; the web answers USE_MOBILE_APP (M1)',
    }),
  })
  .meta({ id: 'Role' });

/** A job title with a level, 1 being the highest. It grants no permissions (spec 4.2). */
export const Designation = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    level: z.int().min(1).max(10),
    defaultRole: Key.meta({ description: 'The role new users with this designation get' }),
    canHaveReports: z.boolean(),
    ranked: z.boolean().default(false).meta({
      description: 'Whether people with it appear in rankings, one group per designation (D8)',
    }),
  })
  .meta({ id: 'Designation' });

/** One level of the territory tree, highest first, such as Zone → Region → Area (spec 5.4). */
export const GeographyLevel = z
  .strictObject({ key: Key, name: LocalizedNoun })
  .meta({ id: 'GeographyLevel' });

export type Role = z.output<typeof Role>;
export type Designation = z.output<typeof Designation>;
export type GeographyLevel = z.output<typeof GeographyLevel>;

/** Issues for keys that appear more than once in a list of keyed entries. */
export function repeatedKeys(
  entries: readonly { key: string }[],
  path: Path,
  noun: string,
): ErrorDetail[] {
  const keys = entries.map((entry) => entry.key);
  return repeats(keys).map((index) =>
    issueAt([...path, index, 'key'], `${noun} \`${keys[index]}\` appears more than once`),
  );
}

/**
 * Checks the roles: every system role is there, and the tenant admin holds every permission, so
 * an admin can never be locked out of anything.
 */
export function checkRoles(roles: readonly Role[], path: Path): ErrorDetail[] {
  const issues = repeatedKeys(roles, path, 'Role');
  const keys = new Set(roles.map((role) => role.key));
  for (const key of SYSTEM_ROLES) {
    if (!keys.has(key)) issues.push(issueAt(path, `Add the system role \`${key}\` (spec 4.2)`));
  }
  roles.forEach((role, index) => {
    for (const repeat of repeats(role.permissions)) {
      issues.push(
        issueAt(
          [...path, index, 'permissions', repeat],
          `Permission \`${role.permissions[repeat]}\` appears more than once`,
        ),
      );
    }
    if (role.key === 'tenant_admin') {
      const missing = TENANT_PERMISSIONS.filter(
        (permission) => !role.permissions.includes(permission),
      );
      if (missing.length > 0) {
        issues.push(
          issueAt(
            [...path, index, 'permissions'],
            `The tenant admin holds every permission; add ${missing.map((p) => `\`${p}\``).join(', ')}`,
          ),
        );
      }
      if (role.scope !== 'tenant') {
        issues.push(
          issueAt([...path, index, 'scope'], 'The tenant admin reaches the whole tenant'),
        );
      }
    }
  });
  return issues;
}

/** Checks the designations: known default roles, and someone to rank. */
export function checkDesignations(
  designations: readonly Designation[],
  roles: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const issues = repeatedKeys(designations, path, 'Designation');
  designations.forEach((designation, index) => {
    if (!roles.has(designation.defaultRole)) {
      issues.push(
        issueAt([...path, index, 'defaultRole'], `There is no role \`${designation.defaultRole}\``),
      );
    }
  });
  if (!designations.some((designation) => designation.ranked)) {
    issues.push(issueAt(path, 'Rank at least one designation, or no one appears in rankings (D8)'));
  }
  if (designations.length > 1 && !designations.some((designation) => designation.canHaveReports)) {
    issues.push(issueAt(path, 'At least one designation must be able to have reports'));
  }
  return issues;
}
