import { toAppError } from '@avchetan/shared';
import { type AskEvent, askRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { readBody } from './read-body';

export function askRoutes({ ask }: AppDeps) {
  return new Hono<AppEnv>().post('/ask', async (c) => {
    if (!ask) {
      throw new ApiError(
        503,
        'ask_unavailable',
        'This server has no model for answering questions',
      );
    }
    const request = await readBody(c, askRequestSchema);
    return streamSSE(c, async (stream) => {
      const send = (event: AskEvent) => stream.writeSSE({ data: JSON.stringify(event) });
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      try {
        const result = await ask(
          request,
          (text) => void send({ type: 'text', text }),
          abort.signal,
        );
        await send({ type: 'done', ...result });
      } catch (error) {
        // The answer has started streaming, so the failure travels as an event.
        const { code, message } = toAppError(error);
        await send({ type: 'error', code, message });
      }
    });
  });
}
