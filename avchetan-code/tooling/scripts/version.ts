/**
 * One version for every app: the desktop app, its Rust shell, the phone app and the server.
 * Run from avchetan-code/:
 *   pnpm version:set 0.2.0     writes it everywhere
 *   pnpm version:check         fails if the files disagree
 *   pnpm version:check v0.2.0  also fails if they disagree with this tag (the release workflow)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+$/;

const PACKAGE_JSONS = [
  'apps/desktop/package.json',
  'apps/mobile/package.json',
  'apps/server/package.json',
];
const APP_JSON = 'apps/mobile/app.json';
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml';
const CARGO_LOCK = 'apps/desktop/src-tauri/Cargo.lock';
const CRATE = 'avchetan-desktop';

/** `version = "…"` of our crate: the first one in Cargo.toml, the crate's entry in Cargo.lock. */
const cargoTomlVersion = /^(version = ")([^"]+)(")/m;
const cargoLockVersion = new RegExp(`(name = "${CRATE}"\\r?\\nversion = ")([^"]+)(")`);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function versions(): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {};
  for (const path of PACKAGE_JSONS) found[path] = JSON.parse(read(path)).version;
  found[APP_JSON] = JSON.parse(read(APP_JSON)).expo.version;
  found[CARGO_TOML] = cargoTomlVersion.exec(read(CARGO_TOML))?.[2];
  found[CARGO_LOCK] = cargoLockVersion.exec(read(CARGO_LOCK))?.[2];
  return found;
}

/** Replaces the `"version": "…"` value in place, so the file's formatting stays as it was. */
function setJsonVersion(path: string, version: string, nested: boolean): void {
  const text = read(path);
  const pattern = nested
    ? /("expo":\s*\{[\s\S]*?"version":\s*")([^"]+)(")/
    : /("version":\s*")([^"]+)(")/;
  if (!pattern.test(text)) throw new Error(`no version in ${path}`);
  writeFileSync(path, text.replace(pattern, `$1${version}$3`));
}

function setCargoVersion(path: string, pattern: RegExp, version: string): void {
  const text = read(path);
  if (!pattern.test(text)) throw new Error(`no ${CRATE} version in ${path}`);
  writeFileSync(path, text.replace(pattern, `$1${version}$3`));
}

function set(version: string): void {
  if (!SEMVER.test(version)) fail(`"${version}" is not a version like 0.2.0`);
  for (const path of PACKAGE_JSONS) setJsonVersion(path, version, false);
  setJsonVersion(APP_JSON, version, true);
  setCargoVersion(CARGO_TOML, cargoTomlVersion, version);
  setCargoVersion(CARGO_LOCK, cargoLockVersion, version);
  check();
  process.stdout.write(`Version ${version} written. Commit it, then tag v${version}.\n`);
}

function check(tag?: string): void {
  const found = versions();
  const distinct = new Set(Object.values(found));
  if (distinct.size !== 1 || distinct.has(undefined)) {
    const lines = Object.entries(found).map(([path, v]) => `  ${path}: ${v ?? '(none)'}`);
    fail(`The versions disagree; run pnpm version:set <version>:\n${lines.join('\n')}`);
  }
  const [version] = distinct;
  if (tag !== undefined && tag.replace(/^refs\/tags\//, '') !== `v${version}`) {
    fail(
      `Tag ${tag} doesn't match version ${version}. Run pnpm version:set, commit, and tag v<version>.`,
    );
  }
  process.stdout.write(`Version ${version}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [command, argument] = process.argv.slice(2);
if (command === 'set' && argument) set(argument);
else if (command === 'check') check(argument);
else fail('Usage: version.ts set <x.y.z> | check [tag]');
