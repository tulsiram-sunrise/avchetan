import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * The hub proves it holds the sync token before a device sends it (ADR-0033). The device sends a
 * random challenge with the health check; the hub answers with an HMAC of it, keyed by the
 * SHA-256 of the token (all the hub keeps). A device that can't match it never sends its token
 * to that address. Shared by the server and the apps, so both compute the same thing.
 */

/** 16 random bytes as hex; the server accepts 32 to 128 hex characters. */
export const CHALLENGE_PATTERN = /^[0-9a-f]{32,128}$/;

const PROOF_LABEL = 'avchetan-hub-proof/v1';

/** The key both sides hold: the token's SHA-256 in hex, as the server stores it. */
export function tokenKey(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

/** What the hub answers to `challenge`, bound to its server ID. */
export function hubProof(tokenHash: string, serverId: string, challenge: string): string {
  const message = utf8ToBytes(`${PROOF_LABEL}|${serverId}|${challenge}`);
  return bytesToHex(hmac(sha256, utf8ToBytes(tokenHash), message));
}

export function newChallenge(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Compares in time that doesn't depend on where the first difference is. */
export function proofMatches(given: string, wanted: string): boolean {
  if (given.length !== wanted.length) return false;
  let difference = 0;
  for (let index = 0; index < wanted.length; index += 1) {
    difference |= given.charCodeAt(index) ^ wanted.charCodeAt(index);
  }
  return difference === 0;
}
