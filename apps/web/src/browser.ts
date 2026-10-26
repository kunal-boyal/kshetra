/**
 * Where the browser is sent away to, such as single sign-on or a download, and its print dialog;
 * a seam, so tests can watch it.
 */
export const browser = {
  go(url: string) {
    window.location.assign(url);
  },
  /** Opens the print dialog; most browsers return once it closes (decision D99). */
  print() {
    window.print();
  },
};
