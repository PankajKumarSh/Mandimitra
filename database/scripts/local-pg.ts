/**
 * Runs a real PostgreSQL 17 server from npm-shipped native binaries (embedded-postgres).
 * Alternative to Docker for machines without WSL/Docker. Data persists in database/.pgdata.
 *
 *   npm run db:start      (leave running; Ctrl+C to stop)
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '..', '.pgdata');
const port = Number(process.env.PG_LOCAL_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'mandimitra',
  password: 'mandimitra_dev',
  port,
  persistent: true,
  // Windows initdb defaults to WIN1252, which cannot store Devanagari. Force UTF-8.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log(`Initialising new cluster in ${dataDir} …`);
  await pg.initialise();
}
await pg.start();
if (firstRun) await pg.createDatabase('mandimitra');

console.log(`PostgreSQL running on localhost:${port} (db: mandimitra, user: mandimitra). Ctrl+C to stop.`);

const stop = async () => {
  console.log('\nStopping PostgreSQL …');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
