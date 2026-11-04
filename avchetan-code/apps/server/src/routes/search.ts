import { toAppError } from '@avchetan/shared';
import { searchRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { searchLogs } from '../embeddings/search';
import { readBody } from './read-body';

export function searchRoutes({ db, search }: AppDeps) {
  return new Hono<AppEnv>().post('/search', async (c) => {
    if (!search) {
      throw new ApiError(503, 'search_unavailable', 'This server has no embedding model set up');
    }
    const { query, from, to, limit } = await readBody(c, searchRequestSchema);
    let vector: number[];
    try {
      vector = await search.embed(query);
    } catch (error) {
      throw new ApiError(503, 'search_unavailable', 'The embedding model did not answer', {
        reason: toAppError(error).code,
      });
    }
    return c.json({
      results: await searchLogs(db, { vector, model: search.model, limit, from, to }),
    });
  });
}
