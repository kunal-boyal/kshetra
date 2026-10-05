import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** The ESLint flat config every package re-exports from its own eslint.config.js. */
export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  prettier,
);
