import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

/**
 * Namespace for all derived (UUIDv5) IDs. It must never change once data exists:
 * changing it would give every derived row a new identity and break convergence.
 */
export const AVCHETAN_NAMESPACE = '3f82d4cc-5580-4f80-8b31-14b27669655f';

const PART_SEPARATOR = '\u001f';

export type IdPart = string | number;

/** New identity for a user-created row (UUIDv7: time-ordered, sortable). */
export function newId(): string {
  return uuidv7();
}

/**
 * Deterministic identity for a row whose identity follows from other data
 * (extracted items, tags, links, entities, daily briefs). Same inputs → same ID on
 * every device, so duplicate processing converges instead of duplicating.
 * Normalize inputs before calling (e.g. tag paths must already be kebab-case).
 */
export function derivedId(kind: string, ...parts: IdPart[]): string {
  const all = [kind, ...parts].map((part) => {
    const text = String(part);
    if (text.length === 0) {
      throw new TypeError('derivedId parts must be non-empty');
    }
    if (text.includes(PART_SEPARATOR)) {
      throw new TypeError('derivedId parts must not contain the unit separator (U+001F)');
    }
    return text;
  });
  return uuidv5(all.join(PART_SEPARATOR), AVCHETAN_NAMESPACE);
}

/** Generator signature used where ID creation is injected (tests use sequential IDs). */
export type IdGenerator = () => string;
