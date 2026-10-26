/**
 * Base error with a stable `code` that UI and retry logic switch on.
 * Never put user content, prompts or secrets into `message` or `details`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {}
export class DbError extends AppError {}
export class SyncError extends AppError {}
export class LlmError extends AppError {}
export class NativeError extends AppError {}

/** Wrap anything thrown into an AppError (unknown errors get code `internal`). */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError('internal', error.message, { cause: error });
  }
  return new AppError('internal', 'Unknown error', { details: { thrown: typeof error } });
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Run an async operation at a boundary and capture failures as a Result. */
export async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return err(toAppError(error));
  }
}
