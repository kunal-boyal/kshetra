/**
 * Where the browser is sent away to, such as single sign-on or a download; a seam, so tests can
 * watch it.
 */
export const browser = {
  go(url: string) {
    window.location.assign(url);
  },
};
