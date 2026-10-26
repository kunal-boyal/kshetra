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
// Error reports are off without a DSN; the SDK's native parts never load in Jest (decision D98).
jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

// Maps draw natively; in tests a map is a view with its label, and a marker one with its title.
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const MapView = (props: { accessibilityLabel?: string; children?: unknown }) =>
    createElement(
      View,
      { accessibilityLabel: props.accessibilityLabel, role: 'img' },
      props.children,
    );
  return {
    __esModule: true,
    default: MapView,
    PROVIDER_GOOGLE: 'google',
    Marker: (props: { title?: string; children?: unknown }) =>
      createElement(
        View,
        { accessibilityLabel: props.title, testID: 'map-marker' },
        props.children,
      ),
    Circle: () => null,
    Polyline: () => null,
  };
});
