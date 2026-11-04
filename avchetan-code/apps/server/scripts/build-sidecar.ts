// Builds the hub the desktop app runs (ADR-0024): the server as a Node single executable
// application, named for Tauri's externalBin, with PGlite's folders beside it.
//   dist/sidecar/avchetan-hub-<target triple>[.exe]
//   dist/sidecar/node_modules/@electric-sql/{pglite,pglite-pgvector}
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { inject } from 'postject';

// Tauri finds a sidecar by the Rust target triple of the machine it builds for.
const TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};
const triple = TRIPLES[`${process.platform}-${process.arch}`];
if (!triple) throw new Error(`No sidecar build for ${process.platform}-${process.arch} yet`);

const out = resolve('dist/sidecar');
const work = resolve('dist/sidecar-work');
rmSync(out, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

// Node 24's single executables run CommonJS only.
await build({
  entryPoints: ['src/index.ts'],
  outfile: join(work, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector', 'pg-native'],
  // Inside the executable require() loads only built-ins, so PGlite comes from beside it.
  banner: {
    js: "var require = require('node:sea').isSea() ? require('node:module').createRequire(process.execPath) : require;",
  },
  logLevel: 'warning',
});

const blob = join(work, 'sea-prep.blob');
writeFileSync(
  join(work, 'sea-config.json'),
  JSON.stringify({
    main: join(work, 'server.cjs'),
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')], {
  stdio: 'inherit',
});

const exe = join(out, `avchetan-hub-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
copyFileSync(process.execPath, exe);
// Injecting breaks node.exe's own signature; release builds sign the result (public release).
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

for (const pkg of ['pglite', 'pglite-pgvector']) {
  cpSync(
    join('node_modules', '@electric-sql', pkg),
    join(out, 'node_modules', '@electric-sql', pkg),
    {
      recursive: true,
      dereference: true,
    },
  );
}
rmSync(work, { recursive: true, force: true });
process.stdout.write(`built ${exe} (${(statSync(exe).size / 1e6).toFixed(1)} MB)\n`);
