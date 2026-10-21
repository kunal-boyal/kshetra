import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Locally the API serves both the directory and the cell. Proxying both through this origin keeps
// the refresh cookie same-site and needs no CORS (spec 13.1).
const api = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repository root serves every app; only VITE_ variables reach the browser.
  envDir: '../..',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/auth': api, '/v1': api },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // Maps draw nothing in jsdom; tests see the no-key notice whatever the local .env holds.
    env: { VITE_GOOGLE_MAPS_API_KEY: '' },
    // Each screen test renders the whole router in jsdom; a busy CI runner needs more than 5 s.
    testTimeout: 20_000,
  },
});
