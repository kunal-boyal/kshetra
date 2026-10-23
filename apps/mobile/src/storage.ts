import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the app keeps what must survive a restart, in the phone's secure store (spec 13.1): the
 * session, the device key and the person's choices. Items stay readable after the first unlock,
 * so background work (location uploads in phase 1) can use the session while the screen is
 * locked, and never move to another phone through a backup: the device key binds this phone only
 * (M1, rule 5), so a restored or new phone signs in afresh.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// Keys may hold letters, digits, dots, dashes and underscores.
const prefix = `${Constants.expoConfig?.slug ?? 'thelamp'}.`;

export const storage = {
  /** Read synchronously, so choices apply before the first frame. */
  read(key: string): string | null {
    return SecureStore.getItem(prefix + key, OPTIONS);
  },
  write(key: string, value: string): void {
    SecureStore.setItem(prefix + key, value, OPTIONS);
  },
  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(prefix + key, OPTIONS);
  },
};
