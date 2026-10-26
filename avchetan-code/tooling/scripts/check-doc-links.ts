/**
 * Checks every relative Markdown link in docs/, CLAUDE.md and README.md: the target file
 * must exist and `#anchors` must match a heading (GitHub's slug rules, which the docs site
 * also uses). Run from avchetan-code/: `pnpm docs:check-links`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return entry.endsWith('.md') ? [path] : [];
  });
}

/** Lines outside fenced code blocks (code lines become empty, keeping line numbers). */
function proseLines(text: string): string[] {
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
}

/** Heading text as GitHub renders it before slugging: no code ticks, link text only. */
const headingText = (raw: string) =>
  raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');

const anchorCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  for (const line of proseLines(readFileSync(file, 'utf8'))) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) anchors.add(slugger.slug(headingText(heading[1] as string)));
  }
  anchorCache.set(file, anchors);
  return anchors;
}

const files = [
  ...markdownFiles(join(repoRoot, 'docs')),
  join(repoRoot, 'CLAUDE.md'),
  join(repoRoot, 'README.md'),
];

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const problems: string[] = [];
let checked = 0;

for (const file of files) {
  proseLines(readFileSync(file, 'utf8')).forEach((line, index) => {
    // Links inside inline code are examples, not links.
    for (const match of line.replace(/`[^`]*`/g, '').matchAll(LINK)) {
      const href = match[1] as string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // http:, https:, mailto:, …
      checked += 1;
      const [pathPart, anchor] = href.split('#') as [string, string | undefined];
      const target = pathPart ? resolve(dirname(file), decodeURI(pathPart)) : file;
      const where = `${relative(repoRoot, file)}:${index + 1}`;
      if (!existsSync(target)) {
        problems.push(`${where} → missing file: ${href}`);
        continue;
      }
      if (anchor && target.endsWith('.md') && !anchorsOf(target).has(anchor)) {
        problems.push(`${where} → missing anchor: ${href}`);
      }
    }
  });
}

if (problems.length > 0) {
  process.stderr.write(`Broken documentation links:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`doc links ok: ${checked} links in ${files.length} files\n`);
