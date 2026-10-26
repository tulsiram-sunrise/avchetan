import { normalizeTagPath } from './tags';

/**
 * Deterministic parsing of what the user typed — never done by the LLM
 * (docs/architecture/extraction-pipeline.md §1). The raw text itself is stored unchanged.
 */
export type ParsedCapture = {
  /** Normalized, de-duplicated explicit tag paths, in order of appearance. */
  tagPaths: string[];
  /** `!private` present: process only with local models (docs/product/advancements.md §6). */
  isPrivate: boolean;
};

/**
 * `#tag` must start the text or follow whitespace / an opening bracket, so `C#`, `x#y`
 * and URL fragments (`site.com/#top`) are not tags. A tag may contain letters (any
 * script), combining marks, digits, `-`, `_` and `/` (hierarchy: `#health/knee`).
 */
const TAG_PATTERN = /(?<=^|[\s([{])#([\p{L}\p{M}\p{N}_/-]+)/gu;

const PRIVATE_PATTERN = /(?<=^|\s)!private(?=$|[\s.,;:!?)\]}])/i;

export function parseCaptureText(content: string): ParsedCapture {
  const tagPaths: string[] = [];
  for (const match of content.matchAll(TAG_PATTERN)) {
    const raw = match[1] as string;
    // `#1`, `#2026` are references or numbers, not tags.
    if (/^[\d/_-]+$/.test(raw)) continue;
    const path = normalizeTagPath(raw);
    if (path && !tagPaths.includes(path)) tagPaths.push(path);
  }
  return { tagPaths, isPrivate: PRIVATE_PATTERN.test(content) };
}
