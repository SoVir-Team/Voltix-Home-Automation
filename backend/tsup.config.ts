import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // bundle the workspace protocol package (shipped as TS source); keep npm deps external
  noExternal: ['@voltix/protocol'],
});
