import { type EmbeddingModel, embedMany } from 'ai';
import { toLlmError } from '../providers/errors';

/** Long enough for any real entry; keeps one pasted essay from filling a small model's window. */
const MAX_TEXT_LENGTH = 4_000;

export type EmbeddingSource = {
  content: string;
  /** Titles of the activities and tasks extracted from the entry. */
  titles: readonly string[];
  tagPaths: readonly string[];
};

/**
 * What a raw log is searched by (docs/architecture/retrieval.md): its own words, plus what was
 * extracted from it, so a search for "knee" also finds "physio, left leg" tagged `knee`.
 */
export function embeddingText({ content, titles, tagPaths }: EmbeddingSource): string {
  const parts = [content.trim()];
  if (titles.length > 0) parts.push(titles.join('; '));
  if (tagPaths.length > 0) parts.push(tagPaths.map((path) => `#${path}`).join(' '));
  return parts.join('\n').slice(0, MAX_TEXT_LENGTH);
}

/** One vector per text, in order. Failures become `LlmError`s, as for the language models. */
export async function embedTexts(
  model: EmbeddingModel,
  values: readonly string[],
): Promise<number[][]> {
  if (values.length === 0) return [];
  try {
    const { embeddings } = await embedMany({ model, values: [...values], maxRetries: 1 });
    return embeddings;
  } catch (error) {
    throw toLlmError(error);
  }
}
