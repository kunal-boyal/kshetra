/**
 * Renaming the product (decision D1): `product.json` holds the name and identifiers, and these
 * pure functions work out what a rename may change and rewrite text to match.
 *
 * - The display name and the package scope can change at any time.
 * - The slug and the app ID can change only until launch. Afterwards the slug names live things
 *   (token issuers, the refresh cookie, Redis keys, every AWS resource), and Google Play never lets
 *   a published app change its ID.
 * - What outside services registered (the Expo project, the Firebase project, the repository) and
 *   the local services' names stay as they are: `keep` protects them, and `skip` leaves files alone.
 */

export interface Names {
  /** Where people read it: the app's name, page titles, photo stamps. */
  name: string;
  /** Identifiers: `PRODUCT_SLUG`, cookie and Redis prefixes, AWS resource names. */
  slug: string;
  /** The workspace packages' npm scope, `@<scope>/...`. */
  scope: string;
  /** The Android application ID and iOS bundle ID; variants add `.dev` or `.e2e`. */
  appId: string;
}

export interface Product extends Names {
  about: string;
  /** Set once the first store build is uploaded; the slug and app ID are then fixed. */
  launched: boolean;
  /** Names outside services registered, which a pull request can't change. */
  external: Record<string, string>;
  /** Patterns of text never rewritten. */
  keep: string[];
  /** Files never rewritten. */
  skip: string[];
}

const SLUG = /^[a-z][a-z0-9]{1,29}$/;
const APP_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** The names after a rename, and why it can't happen, if it can't. */
export function plan(current: Product, asked: Partial<Names>): { next: Names; problems: string[] } {
  const slug = asked.slug ?? current.slug;
  const slugChanges = slug !== current.slug;
  const next: Names = {
    name: (asked.name ?? current.name).trim(),
    slug,
    scope: asked.scope ?? (slugChanges ? slug : current.scope),
    appId: asked.appId ?? (slugChanges && !current.launched ? `com.${slug}.app` : current.appId),
  };
  const problems: string[] = [];
  if (next.name.length === 0 || next.name.length > 40) {
    problems.push('The name must be 1 to 40 characters.');
  }
  if (!SLUG.test(next.slug)) {
    problems.push('The slug must be 2 to 30 lowercase letters and digits, starting with a letter.');
  }
  if (!SLUG.test(next.scope)) {
    problems.push(
      'The scope must be 2 to 30 lowercase letters and digits, starting with a letter.',
    );
  }
  if (!APP_ID.test(next.appId)) {
    problems.push('The app ID must look like com.example.app.');
  }
  if (current.launched && slugChanges) {
    problems.push(
      'The product has launched, so its slug is fixed: it names live tokens, cookies, Redis keys and AWS resources. Change the name instead.',
    );
  }
  if (current.launched && next.appId !== current.appId) {
    problems.push('The product has launched, and Google Play never lets an app change its ID.');
  }
  return { next, problems };
}

/** Each old string with its new one, longest first; unchanged names are left out. */
export function replacements(from: Names, to: Names): [string, string][] {
  const pairs: [string, string][] = [
    [`@${from.scope}/`, `@${to.scope}/`],
    [from.appId, to.appId],
    [from.name, to.name],
    [from.slug, to.slug],
    [from.slug.toUpperCase(), to.slug.toUpperCase()],
  ];
  const seen = new Set<string>();
  return pairs
    .filter(([old, next]) => old !== next && !seen.has(old) && seen.add(old))
    .sort(([a], [b]) => b.length - a.length);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every old string replaced in one pass, so a new name that contains an old one is
 * never replaced again, outside the parts `keep` matches.
 */
export function rewrite(text: string, pairs: [string, string][], keep: string[] = []): string {
  if (pairs.length === 0) return text;
  const lookup = new Map(pairs);
  const olds = new RegExp(pairs.map(([old]) => escape(old)).join('|'), 'g');
  const change = (part: string) => part.replace(olds, (found) => lookup.get(found)!);
  if (keep.length === 0) return change(text);
  const kept = new RegExp(keep.map((pattern) => `(?:${pattern})`).join('|'), 'g');
  let result = '';
  let from = 0;
  for (const match of text.matchAll(kept)) {
    if (match[0].length === 0) continue;
    result += change(text.slice(from, match.index)) + match[0];
    from = match.index + match[0].length;
  }
  return result + change(text.slice(from));
}

/** The services to update by hand after a rename, as a pull request can't reach them. */
export function followUps(from: Names, to: Names): string[] {
  const steps: string[] = [];
  if (from.name !== to.name) {
    steps.push(
      `Set PRODUCT_NAME="${to.name}" wherever it is set outside the repository: EAS environment variables, and the cell's Terraform variables (product_name).`,
    );
  }
  if (from.slug !== to.slug) {
    steps.push(
      `Set PRODUCT_SLUG=${to.slug} in your own .env and in EAS. Everyone signed in locally signs in again, as tokens and the refresh cookie are named from it.`,
    );
  }
  if (from.appId !== to.appId) {
    steps.push(
      `Register ${to.appId}, ${to.appId}.dev and ${to.appId}.e2e as Android apps in the Firebase project, and give EAS the new google-services.json (GOOGLE_SERVICES_JSON).`,
      `Allow ${to.appId} and ${to.appId}.dev on the Google Maps Android key.`,
      'Make a new development build: a build with the new ID installs beside the old one.',
    );
  }
  return steps;
}
