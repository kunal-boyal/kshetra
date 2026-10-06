/**
 * The browser stand-in for the secure store. The field app ships on phones only; its web target
 * exists for development, so a build for the web refuses to start rather than keep tokens in a
 * browser. The tenant web portal is apps/web.
 */
if (!__DEV__) {
  throw new Error('The field app runs on phones. Use apps/web in a browser.');
}

const prefix = 'kshetra-mobile-dev.';

export const storage = {
  read(key: string): string | null {
    return localStorage.getItem(prefix + key);
  },
  write(key: string, value: string): void {
    localStorage.setItem(prefix + key, value);
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(prefix + key);
  },
};
