import { createRequire } from 'node:module';

const preset = createRequire(import.meta.url)('jest-expo/jest-preset');

// Packages Jest must compile: React Native ships source, and some packages ship only ES modules.
const COMPILED = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  '@expo-google-fonts/.*',
  'react-navigation',
  '@react-navigation/.*',
  'react-native-svg',
  'lucide-react-native',
  'uuid',
];

/** jest-expo, plus its Babel transform for the .mjs builds React Native resolves to. */
export default {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.ts'],
  transform: { '\\.mjs$': preset.transform['\\.[jt]sx?$'] },
  transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/)?(${COMPILED.join('|')}))`],
};
