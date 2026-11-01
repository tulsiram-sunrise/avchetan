import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from '../api-error';

export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'validation', 'The request body is not valid', {
      issues: parsed.error.issues.length,
    });
  }
  return parsed.data;
}
