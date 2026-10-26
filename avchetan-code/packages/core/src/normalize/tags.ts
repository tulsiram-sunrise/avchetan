import { slugify } from '@avchetan/shared';

/**
 * Tag normalization (docs/product/advancements.md §0): lowercase kebab-case segments,
 * the last English word singularized, a few known variants mapped. Applied to explicit
 * `#tags` and to LLM-inferred tags alike, before tags are looked up or created — so
 * `#Injuries`, `injury` and `injuries` all become one tag.
 */

/** Whole-segment variants → canonical form. Keep this list small and unambiguous. */
const SYNONYMS: Readonly<Record<string, string>> = {
  'work-out': 'workout',
  deepwork: 'deep-work',
  'e-mail': 'email',
  'to-do': 'todo',
};

/** Words that look plural but aren't (or shouldn't be singularized). */
const INVARIANT = new Set([
  'news',
  'series',
  'species',
  'physics',
  'mathematics',
  'athletics',
  'aerobics',
  'gymnastics',
  'analytics',
  'economics',
  'politics',
  'yes',
  'this',
  'plus',
  'bus',
  'gas',
  'less',
  'always',
  'kudos',
  'chaos',
  'cosmos',
  'diabetes',
  'abs',
  'glutes',
  'lats',
  'quads',
  'delts',
  'pecs',
  'traps',
  'hamstrings',
  'biceps',
  'triceps',
]);

/** Singularize one lowercase ASCII English word; anything else is returned unchanged. */
export function singularize(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length <= 3 || INVARIANT.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Normalize one path segment: slug, synonym, singular last word. */
export function normalizeTagSegment(segment: string): string {
  const slug = slugify(segment);
  if (!slug) return '';
  const canonical = SYNONYMS[slug] ?? slug;
  const words = canonical.split('-');
  const last = words.pop() as string;
  return [...words, singularize(last)].join('-');
}

/** Normalize a tag path like `Health/Injuries/Shoulder Pains` → `health/injury/shoulder-pain`. */
export function normalizeTagPath(path: string): string {
  return path
    .split('/')
    .map(normalizeTagSegment)
    .filter((segment) => segment.length > 0)
    .join('/');
}
