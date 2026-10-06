import { jest } from '@jest/globals';
import mockSafeArea from 'react-native-safe-area-context/jest/mock';

// Tests run without a phone: an in-memory store stands in for the secure store, the system font
// for the loaded ones, and fixed insets for the notch.
jest.mock('react-native-safe-area-context', () => mockSafeArea);
jest.mock('./src/storage', () => {
  const values = new Map<string, string>();
  return {
    storage: {
      read: (key: string) => values.get(key) ?? null,
      write: (key: string, value: string) => void values.set(key, value),
      remove: async (key: string) => void values.delete(key),
    },
  };
});
jest.mock('./src/fonts', () => ({ useAppFonts: () => ({ ready: true }) }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: async () => undefined }));
