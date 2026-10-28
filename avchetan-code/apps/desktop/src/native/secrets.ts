import type { SecretName, SecretStore } from '@avchetan/shared';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

/** Secrets in the OS keychain (Windows Credential Manager) via src-tauri/src/commands/secrets.rs. */
export class TauriSecretStore implements SecretStore {
  constructor(private readonly invoke: Invoke) {}

  get(name: SecretName): Promise<string | null> {
    return callNative(this.invoke, 'secret_get', { name }, z.string().nullable());
  }

  async set(name: SecretName, value: string): Promise<void> {
    await callNative(this.invoke, 'secret_set', { name, value }, z.null());
  }

  async delete(name: SecretName): Promise<void> {
    await callNative(this.invoke, 'secret_delete', { name }, z.null());
  }
}
