/**
 * The mobile app names its platform and version on every request, so the API can turn away
 * versions it no longer supports with `UPGRADE_REQUIRED` (M1, rule 8; spec 11.4). The web sends
 * neither header and is never turned away.
 */
export const APP_PLATFORM_HEADER = 'x-app-platform';
export const APP_VERSION_HEADER = 'x-app-version';

export const APP_PLATFORMS = ['android', 'ios'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** A store version: major, minor and patch, such as `1.4.0`. */
export const APP_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

/** Negative when `a` is older than `b`, zero when they are the same, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let part = 0; part < 3; part += 1) {
    const difference = (left[part] ?? 0) - (right[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether an app at `version` is older than the platform's minimum. With no minimum, or a version
 * that isn't one, nothing is turned away: the header only helps an honest app show its update
 * screen, and access never depends on it.
 */
export function isBelowMinimum(version: string, minimum: string | undefined): boolean {
  if (!minimum || !APP_VERSION.test(version)) return false;
  return compareVersions(version, minimum) < 0;
}
