import { jest } from '@jest/globals';
import mockSafeArea from 'react-native-safe-area-context/jest/mock';

// Fixed insets for the notch and the home indicator, as on a phone.
jest.mock('react-native-safe-area-context', () => mockSafeArea);
