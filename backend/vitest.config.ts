import { defineConfig } from 'vitest/config';

export const TEST_DB_PORT = 54329;
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/mandimitra_test`;

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    globalSetup: ['src/tests/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: 'test-secret-that-is-definitely-longer-than-32-chars',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      LOG_LEVEL: 'silent',
      RATE_LIMIT_ENABLED: 'false',
      TENANT_CACHE_TTL_MS: '0',
      DB_POOL_MAX: '5',
    },
  },
});
