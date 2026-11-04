/**
 * One line of the Setup check (docs/user-guide/troubleshooting.md). Packages describe what they
 * found; each app draws the rows and turns `action` into its own button.
 */
export type CheckState = 'ok' | 'problem' | 'optional' | 'info';

/** Fixes an app can offer as a button beside a row. */
export type CheckAction =
  | 'pair'
  | 'sync_settings'
  | 'ai_models'
  | 'download_model'
  | 'date_settings';

export type CheckRow = {
  /** Stable, for React keys and tests. */
  id: string;
  state: CheckState;
  title: string;
  detail?: string;
  /** A section of the troubleshooting guide. */
  helpCode?: string;
  action?: CheckAction;
};

/** Problems first, then optional advice, then what works, so the first lines say what to fix. */
export function sortCheckRows(rows: readonly CheckRow[]): CheckRow[] {
  const order: Record<CheckState, number> = { problem: 0, optional: 1, ok: 2, info: 3 };
  return [...rows].sort((a, b) => order[a.state] - order[b.state]);
}
