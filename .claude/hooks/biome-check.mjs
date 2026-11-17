// PostToolUse hook (Edit|Write): run Biome on the file Claude just changed.
// Same check as the lefthook pre-commit job. Lint problems exit with code 2, so Claude sees them and fixes them.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Git Bash may hand over MSYS paths (/d/work/...); Windows Node needs d:/work/...
const toNative = (p) =>
  process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : p;

const projectDir = toNative(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const workspace = path.join(projectDir, 'avchetan-code');
const biome = path.join(workspace, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // no or bad payload: nothing to lint
}

const filePath = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
if (!filePath) process.exit(0);

const abs = path.resolve(projectDir, toNative(filePath));
const rel = path.relative(workspace, abs);
// Only files inside the pnpm workspace are linted (Biome's config lives there).
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);
if (!existsSync(abs)) process.exit(0);

if (!existsSync(biome)) {
  process.stderr.write('biome-check hook: Biome not installed — run `pnpm install` in avchetan-code/.\n');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [biome, 'check', '--no-errors-on-unmatched', '--files-ignore-unknown=true', '--colors=off', rel],
  { cwd: workspace, encoding: 'utf8' },
);

if (result.status === 0) process.exit(0);

process.stderr.write(
  `Biome found problems in ${rel} (run \`pnpm lint:fix\` in avchetan-code/ to autofix formatting):\n` +
    `${result.stdout ?? ''}${result.stderr ?? ''}`,
);
process.exit(2);
