import { describe, expect, it } from 'vitest';
import { AVCHETAN_NAMESPACE, derivedId, newId } from './ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns UUIDv7 strings', () => {
    expect(newId()).toMatch(UUID_V7);
  });

  it('sorts in creation order', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('derivedId', () => {
  it('locks the namespace and recipe (changing these breaks every derived row)', () => {
    expect(AVCHETAN_NAMESPACE).toBe('3f82d4cc-5580-4f80-8b31-14b27669655f');
    expect(derivedId('category', 'workout')).toBe('3bfe4bc8-879e-5f19-826e-9062d72c1cb5');
    expect(derivedId('activity', '00000000-0000-7000-8000-000000000001', 0)).toBe(
      '10abcc3e-1608-5c26-a988-3934594b7181',
    );
    expect(derivedId('daily-brief', '2026-10-26')).toBe('c3338c39-7e27-5b46-b0f3-8b8443efac0c');
  });

  it('is deterministic and UUIDv5', () => {
    expect(derivedId('tag', 'health/shoulder-pain')).toBe(derivedId('tag', 'health/shoulder-pain'));
    expect(derivedId('tag', 'health/shoulder-pain')).toMatch(UUID_V5);
  });

  it('distinguishes kinds, parts and part boundaries', () => {
    expect(derivedId('task', 'x', 0)).not.toBe(derivedId('activity', 'x', 0));
    expect(derivedId('task', 'x', 0)).not.toBe(derivedId('task', 'x', 1));
    expect(derivedId('k', 'ab', 'c')).not.toBe(derivedId('k', 'a', 'bc'));
  });

  it('treats numbers and their string form the same', () => {
    expect(derivedId('task', 'x', 3)).toBe(derivedId('task', 'x', '3'));
  });

  it('rejects empty parts and the separator character', () => {
    expect(() => derivedId('tag', '')).toThrow(TypeError);
    expect(() => derivedId('tag', 'a\u001fb')).toThrow(TypeError);
  });
});
