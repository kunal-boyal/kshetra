import {
  DesignationDefinition,
  type ErrorDetail,
  issueAt,
  Key,
  LocalizedNoun,
  repeats,
  RoleDefinition,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
} from '@thelamp/shared';
import { z } from 'zod';

type Path = readonly PropertyKey[];

/** Roles and designations share their shape with the roles and designations API (spec 11.2). */
export const Role = RoleDefinition;
export const Designation = DesignationDefinition;

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
