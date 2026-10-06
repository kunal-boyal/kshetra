import { useRouteContext } from '@tanstack/react-router';

/** The API client and query cache every page shares, from the router's context. */
export function useApp() {
  return useRouteContext({ from: '__root__' });
}
