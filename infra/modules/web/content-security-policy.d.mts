/** The web apps' Content-Security-Policy (decision D101); see content-security-policy.mjs. */
export function contentSecurityPolicy(options?: { maps?: boolean; media?: string }): string;

/** The other headers CloudFront adds, for the previews. */
export const SECURITY_HEADERS: Readonly<Record<string, string>>;
