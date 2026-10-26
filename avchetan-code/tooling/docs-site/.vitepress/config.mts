import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { slug } from 'github-slugger';
import { type DefaultTheme, defineConfig } from 'vitepress';

/**
 * Docs site (ADR-0018): VitePress over the repository's docs/ folder — one copy of the
 * docs, readable on GitHub and on GitHub Pages. Run from avchetan-code/:
 * `pnpm docs:dev` / `pnpm docs:build`.
 */

const REPO_URL = 'https://github.com/tulsiram-sunrise/avchetan';
const BRANCH = 'master';
const repoRoot = resolve(import.meta.dirname, '../../../..');
const docsDir = join(repoRoot, 'docs');

// Pages live outside this package (repo-root docs/), where no node_modules can be found
// by walking up — so resolve vue from here explicitly.
const vueDir = dirname(createRequire(import.meta.url).resolve('vue/package.json'));

/** First `# Heading` of a Markdown file, for sidebar labels. */
function titleOf(file: string): string {
  const match = /^#\s+(.+)$/m.exec(readFileSync(file, 'utf8'));
  return match ? (match[1] as string).replace(/`/g, '') : file;
}

/** Sidebar group for one docs/ subfolder: its README first, then pages by file name. */
function group(dir: string, text: string, collapsed = true): DefaultTheme.SidebarItem {
  const abs = join(docsDir, dir);
  const pages = readdirSync(abs)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();
  const items: DefaultTheme.SidebarItem[] = pages.map((f) => ({
    text: titleOf(join(abs, f)),
    link: `/${dir}/${f.replace(/\.md$/, '')}`,
  }));
  if (existsSync(join(abs, 'README.md'))) items.unshift({ text: 'Overview', link: `/${dir}/` });
  return { text, collapsed, items };
}

/** GitHub URL for a repository path (file or folder). */
function githubUrl(repoPath: string, hash: string): string {
  const abs = join(repoRoot, repoPath);
  const kind = existsSync(abs) && statSync(abs).isDirectory() ? 'tree' : 'blob';
  return `${REPO_URL}/${kind}/${BRANCH}/${repoPath.replaceAll('\\', '/')}${hash}`;
}

export default defineConfig({
  title: 'Avchetan',
  description: 'Offline-first personal logger and planner with your choice of AI.',
  base: '/avchetan/',
  srcDir: docsDir,
  cleanUrls: true,
  vite: { resolve: { alias: { vue: vueDir } } },
  lastUpdated: false,
  // GitHub-style folder index: README.md is the page for its folder.
  rewrites: (id) => id.replace(/(^|\/)README\.md$/, '$1index.md'),

  markdown: {
    // Same heading anchors as GitHub, so links work in both places.
    anchor: { slugify: (text) => slug(text) },
    config(md) {
      // Links that leave docs/ (CLAUDE.md, code) or point at folders without a README
      // go to GitHub instead.
      md.core.ruler.push('avchetan-repo-links', (state) => {
        const relativePath = (state.env as { relativePath?: string }).relativePath;
        if (!relativePath) return;
        const fromDir = dirname(join(docsDir, relativePath));
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            if (token.type !== 'link_open') continue;
            const href = token.attrGet('href');
            if (!href || /^[a-z][a-z0-9+.-]*:|^#/i.test(href)) continue;
            const [path = '', hash = ''] = href.split(/(?=#)/);
            const target = resolve(fromDir, decodeURI(path));
            const insideDocs = !relative(docsDir, target).startsWith('..');
            const folderWithoutReadme =
              existsSync(target) &&
              statSync(target).isDirectory() &&
              !existsSync(join(target, 'README.md'));
            if (!insideDocs || folderWithoutReadme) {
              token.attrSet('href', githubUrl(relative(repoRoot, target), hash));
            }
          }
        }
      });
    },
  },

  themeConfig: {
    nav: [
      { text: 'User guide', link: '/user-guide/' },
      { text: 'Developer docs', link: '/' },
      { text: 'Roadmap', link: '/roadmap' },
    ],
    sidebar: [
      { text: 'Start here', items: [{ text: 'Documentation home', link: '/' }] },
      group('user-guide', 'User guide', false),
      group('product', 'Product'),
      group('architecture', 'Architecture'),
      group('conventions', 'Conventions'),
      group('patterns', 'Patterns'),
      group('decisions', 'Decisions (ADRs)'),
      {
        text: 'Planning',
        items: [
          { text: 'Roadmap', link: '/roadmap' },
          { text: 'Open questions', link: '/open-questions' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO_URL }],
    editLink: {
      pattern: `${REPO_URL}/edit/${BRANCH}/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: { message: 'Released under the AGPL-3.0-or-later license.' },
  },
});
