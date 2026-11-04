import { AppError } from '@avchetan/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** A failure with its HTTP status (docs/conventions/api.md). */
export class ApiError extends AppError {
  readonly status: ContentfulStatusCode;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details ? { details } : {});
    this.status = status;
  }
}
