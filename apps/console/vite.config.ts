import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Locally the API serves the console's routes. Proxying them through this origin keeps the
// session cookie same-site and needs no CORS (spec 13.1).
const api = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repository root serves every app; only VITE_ variables reach the browser.
  envDir: '../..',
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: { '/platform': api },
  },
  preview: { host: '127.0.0.1', port: 4174 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 20_000,
  },
});
