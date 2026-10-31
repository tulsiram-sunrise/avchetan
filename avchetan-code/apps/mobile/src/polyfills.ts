import { getRandomValues } from 'expo-crypto';

/** Hermes has no Web Crypto, and `uuid` needs it for `newId()`. */
const scope = globalThis as { crypto?: Partial<Crypto> };
scope.crypto ??= {};
scope.crypto.getRandomValues ??= getRandomValues as Crypto['getRandomValues'];
