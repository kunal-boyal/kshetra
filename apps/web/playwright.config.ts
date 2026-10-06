import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (spec 14.4): the production build in a real browser, with axe checking every
 * screen. The API is mocked here; the full stack runs in the phase 0 exit check.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  // Reduced motion makes every animation instant (bundle.css), so axe judges settled screens,
  // not a frame halfway through a fade.
  use: { baseURL: 'http://127.0.0.1:4173', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
