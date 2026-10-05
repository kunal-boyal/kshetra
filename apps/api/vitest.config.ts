import { defineConfig } from 'vitest/config';

// Unit tests: no database, no network.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
