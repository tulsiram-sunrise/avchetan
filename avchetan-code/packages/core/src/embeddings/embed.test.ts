import { APICallError } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { embeddingText, embedTexts } from './embed';

describe('embeddingText', () => {
  it('adds the extracted titles and tags to the entry', () => {
    expect(
      embeddingText({
        content: '  Physio for the left leg ',
        titles: ['Physio session', 'Book next session'],
        tagPaths: ['health/knee'],
      }),
    ).toBe('Physio for the left leg\nPhysio session; Book next session\n#health/knee');
  });

  it('is the entry alone when nothing was extracted', () => {
    expect(embeddingText({ content: 'Rested', titles: [], tagPaths: [] })).toBe('Rested');
  });

  it('cuts a very long entry', () => {
    const text = embeddingText({ content: 'x'.repeat(10_000), titles: [], tagPaths: [] });
    expect(text).toHaveLength(4_000);
  });
});

describe('embedTexts', () => {
  it('returns one vector per text, in order', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: async ({ values }) => ({
        embeddings: values.map((value) => [value.length, 0]),
        warnings: [],
      }),
    });

    expect(await embedTexts(model, ['a', 'abc'])).toEqual([
      [1, 0],
      [3, 0],
    ]);
  });

  it('reports a failure as an LLM error', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw new APICallError({
          message: 'not found',
          url: 'http://test.invalid',
          requestBodyValues: {},
          statusCode: 401,
        });
      },
    });

    await expect(embedTexts(model, ['a'])).rejects.toMatchObject({ code: 'llm_auth' });
  });
});
