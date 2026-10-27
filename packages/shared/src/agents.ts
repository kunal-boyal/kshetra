/**
 * A browser or app as people know it, from the user agent it sent: for the list of where someone
 * is signed in (decision D101). Only the common names; anything else is null, never a guess.
 */
export function describeAgent(agent: string | null): {
  browser: string | null;
  system: string | null;
} {
  if (!agent) return { browser: null, system: null };
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : null;
  const system = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'macOS'
          : /CrOS/.test(agent)
            ? 'ChromeOS'
            : /Linux/.test(agent)
              ? 'Linux'
              : null;
  return { browser, system };
}
