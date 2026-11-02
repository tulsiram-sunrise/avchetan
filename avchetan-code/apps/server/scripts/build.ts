// Bundles the server into dist/server.mjs. Only what the server imports is included, so the
// image never carries the Expo packages the workspace lockfile links to drizzle-orm.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // PGlite and its pgvector extension load their files from beside their own modules, so they
  // ship as folders. pg only tries pg-native when asked for it.
  external: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector', 'pg-native'],
  // pg is CommonJS and calls require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
