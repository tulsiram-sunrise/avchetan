/**
 * Packages import each other in one direction only (docs/architecture/overview.md#dependency-rules):
 * `shared ← db ← {core, sync}`, and no package imports an app. Checks every TypeScript file in
 * each package (source, tests and scripts alike) and each package's `package.json`. Import cycles
 * inside a package are Biome's `noImportCycles`. Run from avchetan-code/ as part of `pnpm lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..', '..');

/** What each package may import from the workspace. Apps may import any package. */
const ALLOWED: Record<string, readonly string[]> = {
  shared: [],
  db: ['shared'],
  core: ['db', 'shared'],
  sync: ['db', 'shared'],
};

const SPECIFIER = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@avchetan\/([a-z-]+)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (['node_modules', 'dist', 'migrations'].includes(entry) || entry.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mts)$/.test(entry) ? [path] : [];
  });
}

/** Workspace packages a file imports, by name (`@avchetan/db/sqlite` is `db`). */
function importedPackages(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((match) => match[1] as string);
}

function main() {
  const problems: string[] = [];
  const packages = readdirSync(join(workspace, 'packages'));
  for (const name of packages) {
    const allowed = ALLOWED[name];
    if (!allowed) {
      problems.push(`packages/${name}: not in ALLOWED in tooling/scripts/check-package-imports.ts`);
      continue;
    }
    const root = join(workspace, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const target = dep.startsWith('@avchetan/') ? dep.slice('@avchetan/'.length) : null;
      if (target && !allowed.includes(target)) {
        problems.push(`packages/${name}/package.json depends on ${dep}`);
      }
    }
    for (const file of files(root)) {
      for (const target of importedPackages(readFileSync(file, 'utf8'))) {
        if (target !== name && !allowed.includes(target)) {
          problems.push(`${relative(workspace, file)} imports @avchetan/${target}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `Packages import only in one direction: shared ← db ← {core, sync}, never an app.\n` +
        `${problems.map((p) => `  ${p}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`package imports ok: ${packages.length} packages\n`);
}

main();
