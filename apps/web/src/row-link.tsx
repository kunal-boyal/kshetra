import type { RowLink } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';

const made = new Map<string, RowLink>();

/**
 * A router link for the design system's rows and tiles that go somewhere (`as` on `ListItem`,
 * `StatTile` and `KpiTile`). One component is kept per target, so a row isn't mounted afresh on
 * every render.
 */
export function rowLink(to: string, search?: Record<string, string>): RowLink {
  const key = `${to}?${new URLSearchParams(search).toString()}`;
  let found = made.get(key);
  if (!found) {
    found = function RouterRow({ className, children, ...rest }) {
      return (
        <Link to={to} {...(search ? { search } : {})} className={className} {...rest}>
          {children}
        </Link>
      );
    };
    made.set(key, found);
  }
  return found;
}
