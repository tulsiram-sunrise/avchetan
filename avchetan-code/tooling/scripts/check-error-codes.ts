/**
 * Every error code the apps can show must be in ERROR_HELP (packages/shared/src/error-help.ts),
 * and every guide section it names must be a heading in docs/user-guide/troubleshooting.md.
 * Codes are found where they are thrown: TS error classes, Rust strings, LLM codes, Setup check
 * rows, fixed Help links, and the server's startup hints. Run from avchetan-code/:
 * `pnpm errors:check`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';
import { ERROR_HELP } from '../../packages/shared/src/error-help.ts';

const workspace = resolve(import.meta.dirname, '..', '..');
const repoRoot = resolve(workspace, '..');

/** Snake-case strings in the Rust shell that are not error codes (pragmas, serde, clipboard.rs). */
const RUST_NOT_CODES = new Set([
  'cache_size',
  'foreign_keys',
  'journal_mode',
  'snake_case',
  'not_text',
]);

function files(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (['node_modules', 'dist', 'target', 'android', 'gen'].includes(entry)) return [];
    if (entry.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return files(path, extensions);
    return extensions.some((ext) => entry.endsWith(ext)) ? [path] : [];
  });
}

type Found = { code: string; where: string };

function scan(paths: readonly string[], patterns: readonly RegExp[]): Found[] {
  const found: Found[] = [];
  for (const path of paths) {
    if (/\.(test|live)\.tsx?$/.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push({ code: match[1] as string, where: `${relative(workspace, path)}:${line}` });
      }
    }
  }
  return found;
}

const tsFiles = [
  ...files(join(workspace, 'packages'), ['.ts', '.tsx']),
  ...files(join(workspace, 'apps'), ['.ts', '.tsx']),
];
const rustFiles = files(join(workspace, 'apps', 'desktop', 'src-tauri', 'src'), ['.rs']);
const code = "'([a-z]+(?:_[a-z]+)*)'";

const found: Found[] = [
  ...scan(tsFiles, [
    new RegExp(
      `\\b(?:Sync|Llm|Db|Native|Validation|App|Api)Error\\(\\s*(?:\\d+,\\s*)?${code}`,
      'g',
    ),
    new RegExp(`\\bhelpCode: ${code}`, 'g'),
    /<HelpLink code="([a-z_]+)"/g,
  ]),
  ...scan(
    [join(workspace, 'packages', 'core', 'src', 'providers', 'errors.ts')],
    // The LLM_ERROR_CODES list.
    [/^ {2}'(llm_[a-z_]+)',$/gm],
  ),
  ...scan(
    [join(workspace, 'apps', 'server', 'src', 'db', 'startup-hint.ts')],
    [/^\s*'(database_[a-z_]+)',$/gm],
  ),
  ...scan(rustFiles, [/"([a-z]+(?:_[a-z]+)+)"/g]).filter((f) => !RUST_NOT_CODES.has(f.code)),
];

const guide = readFileSync(join(repoRoot, 'docs', 'user-guide', 'troubleshooting.md'), 'utf8');
const slugger = new GithubSlugger();
/** Each section's text by its slug, so the message the app shows can be found in it. */
const sections = new Map<string, string>();
for (const part of guide.split(/^(?=#{2,3} )/m)) {
  const heading = /^#{2,3} (.+)$/m.exec(part)?.[1];
  if (heading) sections.set(slugger.slug(heading), part);
}
const headings = new Set(sections.keys());
/** Typographic and straight apostrophes are the same to a reader. */
const plain = (text: string) => text.replaceAll('’', "'");

const problems: string[] = [];
const known = new Set(Object.keys(ERROR_HELP));
for (const { code: name, where } of found) {
  if (!known.has(name)) problems.push(`${where}: "${name}" is not in ERROR_HELP`);
}
for (const [name, help] of Object.entries(ERROR_HELP)) {
  if (help.section !== null && !headings.has(help.section)) {
    problems.push(`ERROR_HELP.${name}: no "## ${help.section}" in troubleshooting.md`);
  } else if (help.section !== null && help.message !== null) {
    // People search the guide for the words on their screen.
    const text = plain(sections.get(help.section) ?? '');
    if (!text.includes(plain(help.message))) {
      problems.push(`ERROR_HELP.${name}: "## ${help.section}" doesn't quote "${help.message}"`);
    }
  }
}
if (!headings.has('other_errors')) problems.push('troubleshooting.md needs "## other_errors"');

if (problems.length > 0) {
  const lines = [...new Set(problems)].join('\n  ');
  process.stderr.write(`Error codes without help:\n  ${lines}\n`);
  process.exit(1);
}
const inUse = new Set(found.map((f) => f.code)).size;
process.stdout.write(`error codes ok: ${inUse} codes in use, ${known.size} known\n`);
