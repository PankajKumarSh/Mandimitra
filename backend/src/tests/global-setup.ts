/**
 * Boots a throwaway PostgreSQL 17 (real server, native binaries) for the whole test run,
 * applies migrations with the Prisma CLI exactly as production does, then seeds base data.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL, TEST_DB_PORT } from '../../vitest.config.ts';

const databasePkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database');

export default async function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mandimitra-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: TEST_DB_PORT,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('mandimitra_test');

  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execSync('npx prisma migrate deploy', { cwd: databasePkg, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd: databasePkg, env, stdio: 'pipe' });

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
