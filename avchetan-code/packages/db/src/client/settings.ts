import { createLogger, ValidationError } from '@avchetan/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { settings } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';

const log = createLogger('settings');

/**
 * One device-local setting: its key, the Zod schema every stored value is read through, and the
 * value used when nothing is stored or what is stored can't be read. Settings never sync and never
 * hold secrets (those live in the platform SecretStore).
 */
export type Setting<T> = {
  readonly key: string;
  /** The stored value, or the default when none is stored or it no longer reads. */
  load(db: ClientDb | Tx): Promise<T>;
  /** Checks the value with the schema, then stores it; a value that fails is a bug. */
  save(tx: Tx, value: T, now: string): Promise<void>;
  /** Reads any value through the schema, with the same default as `load`. */
  parse(value: unknown): T;
};

export function defineSetting<S extends z.ZodType>(
  key: string,
  schema: S,
  fallback: z.output<S>,
): Setting<z.output<S>> {
  const parse = (value: unknown): z.output<S> => {
    if (value === undefined || value === null) return fallback;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    // The key only, never the value: a setting can hold words the user typed (a draft).
    log.warn('setting unreadable, using its default', { key });
    return fallback;
  };
  return {
    key,
    parse,
    async load(db) {
      const row = await db.select().from(settings).where(eq(settings.key, key)).get();
      return parse(row?.value);
    },
    async save(tx, value, now) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new ValidationError(
          'invalid_input',
          `Setting ${key} was given a value it can't hold`,
        );
      }
      await tx
        .insert(settings)
        .values({ key, value: parsed.data, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data, updatedAt: now } });
    },
  };
}

type SettingsOf<T> = { readonly [K in keyof T]: Setting<T[K]> };

/** Several settings read and saved together, each field falling back to its own default. */
export type SettingGroup<T> = {
  readonly settings: SettingsOf<T>;
  load(db: ClientDb | Tx): Promise<T>;
  save(tx: Tx, changes: Partial<T>, now: string): Promise<void>;
};

export function defineSettingGroup<T extends Record<string, unknown>>(
  settings: SettingsOf<T>,
): SettingGroup<T> {
  const keys = Object.keys(settings) as (keyof T)[];
  return {
    settings,
    async load(db) {
      const values = await Promise.all(keys.map((key) => settings[key].load(db)));
      return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as T;
    },
    async save(tx, changes, now) {
      for (const key of keys) {
        const value = changes[key];
        if (value !== undefined) await settings[key].save(tx, value as T[keyof T], now);
      }
    },
  };
}
