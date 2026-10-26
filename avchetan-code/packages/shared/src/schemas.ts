import { z } from 'zod';
import { isUtcInstant } from './clock';
import { isValidLocalDate, isValidTimeZone } from './dates';

/** Common Zod schemas used at every boundary (sync payloads, LLM output, settings). */

export const uuidSchema = z.uuid();

export const utcInstantSchema = z
  .string()
  .refine(isUtcInstant, { message: 'Expected UTC instant like 2026-10-26T14:03:11.402Z' });

export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, { message: 'Expected local date like 2026-10-26' });

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, { message: 'Expected an IANA time zone like Asia/Kolkata' });
