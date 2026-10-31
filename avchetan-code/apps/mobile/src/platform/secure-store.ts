import type { SecretName, SecretStore } from '@avchetan/shared';

/** The part of expo-secure-store this app uses. */
export type NativeSecureStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

/** Android's keystore-backed storage takes letters, digits, `.`, `-` and `_` in a key, not `:`. */
const storeKey = (name: SecretName) => name.replaceAll(':', '.');

/** Secrets in the Android keystore (CLAUDE.md rule 7). */
export class ExpoSecretStore implements SecretStore {
  constructor(private readonly store: NativeSecureStore) {}

  get(name: SecretName): Promise<string | null> {
    return this.store.getItemAsync(storeKey(name));
  }

  set(name: SecretName, value: string): Promise<void> {
    return this.store.setItemAsync(storeKey(name), value);
  }

  delete(name: SecretName): Promise<void> {
    return this.store.deleteItemAsync(storeKey(name));
  }
}
