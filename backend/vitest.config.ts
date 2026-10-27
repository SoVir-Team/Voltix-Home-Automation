import { defineConfig } from 'vitest/config';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_ORIGIN: 'http://localhost:3000',
  API_ORIGIN: 'http://localhost:4000',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://voltix:voltix_dev@localhost:5433/voltix_test',
  JWT_SECRET: 'test-jwt-secret-0123456789-0123456789-abcdef',
  SECRET_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORAGE_DIR: './storage-test',
};
// globalSetup runs in the main process, which `test.env` does not reach.
Object.assign(process.env, env);

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // One shared test database: run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env,
  },
});
