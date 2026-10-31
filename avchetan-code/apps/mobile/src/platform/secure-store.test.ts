import { describe, expect, it } from 'vitest';
import { ExpoSecretStore, type NativeSecureStore } from './secure-store';

function memoryStore() {
  const items = new Map<string, string>();
  const native: NativeSecureStore = {
    getItemAsync: async (key) => items.get(key) ?? null,
    setItemAsync: async (key, value) => {
      items.set(key, value);
    },
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
  };
  return { items, native };
}

describe('ExpoSecretStore', () => {
  it('stores under a key Android accepts', async () => {
    const { items, native } = memoryStore();
    await new ExpoSecretStore(native).set('provider:groq:apiKey', 'not-a-real-key');
    expect([...items.keys()]).toEqual(['provider.groq.apiKey']);
  });

  it('reads back and deletes', async () => {
    const secrets = new ExpoSecretStore(memoryStore().native);
    await secrets.set('sync:token', 'not-a-real-token');
    expect(await secrets.get('sync:token')).toBe('not-a-real-token');
    await secrets.delete('sync:token');
    expect(await secrets.get('sync:token')).toBeNull();
  });
});
