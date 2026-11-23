import type { LocalDate } from '@avchetan/shared';
import type { AskResult } from '../analysis/ask';
import type { SearchHistory } from '../analysis/tools';
import type { LearnedCommandExample } from '../commands/learning';

/**
 * What a device asks of its hub. `@avchetan/sync` implements it (`createHubClient`) and the
 * apps pass it in, as they pass platform adapters: core can't import sync (package rules).
 */
export type HubClient = {
  /** Whether a hub or server is set up for this device (paired, with an address saved). */
  isSetUp(): Promise<boolean>;
  /** The hub answers with its own model (ADR-0022); cited entries are found on this device. */
  ask(
    request: { question: string; timeZone: string },
    onText: (text: string) => void,
  ): Promise<AskResult>;
  /** The hub makes a day's brief; it arrives here with the next sync. */
  brief(request: {
    date: LocalDate;
    timeZone: string;
    replace: boolean;
  }): Promise<{ status: 'made' | 'exists' | 'empty' }>;
  /** The hub's model reads typed words as a command; `command` is null for none. */
  command(request: {
    input: string;
    examples: LearnedCommandExample[];
  }): Promise<{ command: string | null; text: string }>;
  /** Search by meaning on the hub; `null` when it can't answer. */
  search: SearchHistory;
};

/** Words for this kind of device in messages: "this PC", "Settings → AI → AI models". */
export type DeviceWords = {
  /** `PC` or `phone`. */
  device: string;
  /** Where its AI models are chosen. */
  modelsPlace: string;
};
