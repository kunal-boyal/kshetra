import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/main.ts',
    'src/worker.ts',
    'src/scheduler.ts',
    'src/migrate.ts',
    'src/bootstrap.ts',
    'src/provision.ts',
    'src/invite-staff.ts',
    'src/licence.ts',
    'src/seed.ts',
    'src/load-fixtures.ts',
    'src/e2e-fixtures.ts',
    'src/demo-content.ts',
    'src/openapi.ts',
  ],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Workspace packages are TypeScript source, so they are bundled in; npm dependencies stay external.
  deps: { alwaysBundle: [/^@thelamp\//] },
  // The API reference's browser bundle (decision D94), served at /v1/docs; the package itself is
  // a dev dependency, so the image carries only this one file.
  copy: [
    {
      from: 'node_modules/@scalar/api-reference/dist/browser/standalone.js',
      to: 'dist/docs',
    },
  ],
});
