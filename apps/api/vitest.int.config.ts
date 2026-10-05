import { defineConfig } from 'vitest/config';

// Integration tests against a real PostgreSQL in Docker, started once by test/global-setup.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
