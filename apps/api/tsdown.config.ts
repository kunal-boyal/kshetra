import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts', 'src/bootstrap.ts', 'src/provision.ts', 'src/seed.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Workspace packages are TypeScript source, so they are bundled in; npm dependencies stay external.
  deps: { alwaysBundle: [/^@kshetra\//] },
});
