// The web apps' Content-Security-Policy (decision D101) from content-security-policy.json, as
// CloudFront sends it: each app's Vite preview serves it to the end-to-end tests, and the demo's
// edge writes it for Caddy. This module's main.tf builds the same string for CloudFront.
//
//   node infra/modules/web/content-security-policy.mjs [--maps] [--media <origin>]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sources = JSON.parse(
  readFileSync(new URL('./content-security-policy.json', import.meta.url), 'utf8'),
);

/** The policy for an app that does or doesn't draw Google Maps, with its media origin. */
export function contentSecurityPolicy({ maps = false, media } = {}) {
  const directives = Object.entries(sources.base).map(([name, list]) => {
    const all = [
      ...new Set([
        ...list,
        ...(maps ? (sources.maps[name] ?? []) : []),
        ...(name === 'img-src' && media ? [media] : []),
      ]),
    ];
    // 'none' stands alone; a directive that gained sources drops it.
    const kept = all.length > 1 ? all.filter((source) => source !== "'none'") : all;
    return `${name} ${kept.join(' ')}`;
  });
  return [...directives, 'upgrade-insecure-requests'].join('; ');
}

/**
 * The other headers CloudFront's response policy in main.tf adds (decision D101), so the previews,
 * and ZAP's scans of them, see what production sends. HSTS stays out: previews serve plain HTTP.
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const media = args.includes('--media') ? args[args.indexOf('--media') + 1] : undefined;
  process.stdout.write(contentSecurityPolicy({ maps: args.includes('--maps'), media }));
}
