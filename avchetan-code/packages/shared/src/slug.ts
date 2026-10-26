/**
 * Lowercase kebab-case key for names (categories, projects, tags):
 * `"Deep Work!"` → `deep-work`, `"Café Run"` → `cafe-run`. Returns '' if nothing is left.
 * Linguistic normalization (singulars, synonyms) is `@avchetan/core`'s job, not this.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Strip Latin accents only; other combining marks (e.g. Devanagari vowel signs) stay.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .normalize('NFC')
  );
}

/** Slugify each `/`-separated segment of a tag path, dropping empty segments. */
export function slugifyPath(path: string): string {
  return path
    .split('/')
    .map(slugify)
    .filter((segment) => segment.length > 0)
    .join('/');
}
