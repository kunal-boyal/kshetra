import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import base from './eslint.js';

/** The ESLint flat config for React packages: the base rules, browser globals and the hooks rules. */
export default defineConfig(
  base,
  { languageOptions: { globals: { ...globals.browser } } },
  reactHooks.configs.flat.recommended,
);
