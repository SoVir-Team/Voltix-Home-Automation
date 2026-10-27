import { cpSync } from 'node:fs';
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
  // The migrator reads SQL files next to the bundle (dist/migrations), so ship them with it.
  onSuccess: async () => cpSync('src/db/migrations', 'dist/migrations', { recursive: true }),
});
