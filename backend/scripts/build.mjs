/**
 * Production bundle: dist/server.js and dist/worker.js (ESM, Node 24).
 * Workspace packages (@mandimitra/shared, @mandimitra/database incl. the generated Prisma client, which is
 * TypeScript) are bundled in; every npm dependency stays external and is installed in the image.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dbPkg = JSON.parse(readFileSync(new URL('../../database/package.json', import.meta.url), 'utf8'));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(dbPkg.dependencies ?? {})].filter((d) => !d.startsWith('@mandimitra/'));

await build({
  entryPoints: { server: 'src/server.ts', worker: 'src/worker.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external,
  // Some bundled CJS-style code paths call require(); give ESM output a real one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
