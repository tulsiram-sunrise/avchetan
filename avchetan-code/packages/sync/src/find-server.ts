import { type ClientStore, setSyncState } from '@avchetan/db/sqlite';
import {
  createLogger,
  type HttpFetch,
  isPrivateNetwork,
  isTailscale,
  type SecretStore,
  SyncError,
  toAppError,
} from '@avchetan/shared';
import { z } from 'zod';
import { type ApiClient, createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import { type HealthResponse, hubProof, newChallenge, proofMatches, tokenKey } from './protocol';

const log = createLogger('sync');

/**
 * Finding the hub (product/tasks-routines-reminders.md §15, ADR-0033). A device tries its saved
 * addresses and the ones the hub last told it (`learned`), all at once, and takes the first that
 * is its server and proves it holds the token. A learned address is only a hint, so it must
 * prove itself; a saved one from a server too old to answer the challenge is still used.
 */

export type FoundServer = { baseUrl: string; health: HealthResponse };

/**
 * `wrong_server`: only another server answered. `bad_proof`: a saved address answered as this
 * server but couldn't prove it holds this device's token (the token changed, or an impostor).
 */
export type FindResult = FoundServer | 'wrong_server' | 'bad_proof' | null;

type Candidate = { baseUrl: string; learned: boolean };
type Outcome = 'found' | 'wrong' | 'bad_proof' | 'unproven' | 'unreachable';

async function probe(
  fetch: HttpFetch,
  candidate: Candidate,
  expected: string,
  key: string,
): Promise<{ outcome: Outcome; health?: HealthResponse }> {
  const challenge = newChallenge();
  let health: HealthResponse;
  try {
    health = await fetchHealth(fetch, candidate.baseUrl, challenge);
  } catch (error) {
    log.debug('address did not answer', { code: toAppError(error).code });
    return { outcome: 'unreachable' };
  }
  if (expected && health.serverId !== expected) return { outcome: 'wrong' };
  if (health.proof === undefined) {
    // A server from before ADR-0033: trusted only where the person saved it.
    return candidate.learned ? { outcome: 'unproven' } : { outcome: 'found', health };
  }
  const wanted = hubProof(key, health.serverId, challenge);
  if (!proofMatches(health.proof, wanted)) return { outcome: 'bad_proof' };
  return { outcome: 'found', health };
}

export async function findServer(options: {
  fetch: HttpFetch;
  saved: readonly string[];
  learned: readonly string[];
  /** The server this device expects; empty accepts the first to answer. */
  expected: string;
  token: string;
}): Promise<FindResult> {
  const key = tokenKey(options.token);
  const candidates: Candidate[] = [
    ...options.saved.map((baseUrl) => ({ baseUrl, learned: false })),
    ...options.learned
      .filter((url) => !options.saved.includes(url))
      .map((baseUrl) => ({ baseUrl, learned: true })),
  ];
  if (candidates.length === 0) return null;

  return new Promise<FindResult>((resolve) => {
    let pending = candidates.length;
    let wrong = false;
    let badProof = false;
    let done = false;
    for (const candidate of candidates) {
      void probe(options.fetch, candidate, options.expected, key).then(({ outcome, health }) => {
        pending -= 1;
        if (done) return;
        if (outcome === 'found' && health) {
          done = true;
          resolve({ baseUrl: candidate.baseUrl, health });
          return;
        }
        if (outcome === 'wrong') wrong = true;
        if (outcome === 'bad_proof') {
          log.warn('an address could not prove it is this hub', { learned: candidate.learned });
          if (!candidate.learned) badProof = true;
        }
        if (pending === 0) {
          done = true;
          resolve(badProof ? 'bad_proof' : wrong ? 'wrong_server' : null);
        }
      });
    }
  });
}

// What the hub last said about where it is.

const LEARNED_EVERY_MS = 10 * 60_000;
const MOST_LEARNED = 6;

const learnedSchema = z.object({ at: z.string(), urls: z.array(z.url()).max(MOST_LEARNED) });

export type LearnedAddresses = z.infer<typeof learnedSchema>;

export async function loadLearned(store: ClientStore): Promise<LearnedAddresses | null> {
  const raw = await store.sync.getState('learned_urls');
  if (!raw) return null;
  try {
    const parsed = learnedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    log.warn('unreadable learned addresses');
    return null;
  }
}

/** Whether it's time to ask the hub where it is again. */
export function learnedDue(learned: LearnedAddresses | null, now: string): boolean {
  return learned === null || Date.parse(now) - Date.parse(learned.at) >= LEARNED_EVERY_MS;
}

/**
 * The hub's addresses this device may use: plain-HTTP addresses only on a Tailscale network, or
 * on a home network when the person already trusted one by saving such an address
 * (docs/conventions/security-and-privacy.md#transport). Saved addresses are left out.
 */
export function usableLearned(urls: readonly string[], saved: readonly string[]): string[] {
  const trustsHome = saved.some((url) => isPrivateNetwork(hostOf(url)));
  const usable: string[] = [];
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    const host = parsed.hostname;
    const allowed =
      parsed.protocol === 'https:' || isTailscale(host) || (trustsHome && isPrivateNetwork(host));
    const clean = `${parsed.protocol}//${parsed.host}`;
    if (allowed && !saved.includes(clean) && !usable.includes(clean)) usable.push(clean);
  }
  return usable.slice(0, MOST_LEARNED);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function saveLearned(store: ClientStore, urls: readonly string[]): Promise<void> {
  const value: LearnedAddresses = { at: store.clock.now(), urls: [...urls] };
  await store.write((tx) => setSyncState(tx, 'learned_urls', JSON.stringify(value)));
}

/**
 * A client for this device's hub, for Ask, the brief, commands and search: found as sync finds
 * it, so the token only goes to an address that proved it is the hub.
 */
export async function connectHub(deps: {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get'>;
}): Promise<ApiClient> {
  const { store, fetch, secrets } = deps;
  const saved = await loadServerUrls(store);
  const token = await secrets.get(SYNC_TOKEN_SECRET);
  if (saved.length === 0 || !token) {
    throw new SyncError('not_configured', 'Set up Sync first, so this device can reach your hub');
  }
  const expected =
    (await store.sync.getState('expected_server_id')) ??
    (await store.sync.getState('server_id')) ??
    '';
  const found = await findServer({
    fetch,
    saved,
    learned: usableLearned((await loadLearned(store))?.urls ?? [], saved),
    expected,
    token,
  });
  if (found === 'bad_proof') {
    throw new SyncError('unauthorized', 'Your hub refused this device’s sync token');
  }
  if (found === 'wrong_server') {
    throw new SyncError('wrong_server', 'A different server answered at your hub’s address');
  }
  if (!found) throw new SyncError('server_unreachable', 'Your hub could not be reached');
  return createApiClient({ fetch, baseUrl: found.baseUrl, token, deviceId: store.deviceId });
}
