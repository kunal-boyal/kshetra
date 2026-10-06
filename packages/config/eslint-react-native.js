import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import base from './eslint.js';

/**
 * The ESLint flat config for React Native packages: the base rules, the globals React Native
 * provides (much of the browser's, plus `__DEV__`), and the hooks rules.
 */
export default defineConfig(
  base,
  { ignores: ['.expo/**', 'expo-env.d.ts', 'android/**', 'ios/**', 'dist/**'] },
  { languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } } },
  reactHooks.configs.flat.recommended,
);
