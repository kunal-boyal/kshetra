import { getRandomValues } from 'expo-crypto';

/**
 * What the shared packages expect of a JavaScript runtime and Hermes, on the phone, lacks. It
 * loads before anything else (the root layout imports it first).
 *
 * `newId()` makes UUID v7s with `uuid`, which draws its randomness from Web Crypto's
 * `crypto.getRandomValues`; React Native has no Web Crypto, so expo-crypto supplies it.
 */
const crypto = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
if (typeof crypto?.getRandomValues !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...crypto, getRandomValues },
    configurable: true,
    writable: true,
  });
}
