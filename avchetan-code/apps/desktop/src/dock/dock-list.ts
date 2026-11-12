/**
 * The list under the capture box that ↑/↓ move through (services/dock-keys.ts). Only one list
 * shows at a time, so its rows share one set of ids for the box's `aria-activedescendant`.
 */
export const DOCK_LIST_ID = 'dock-list';

export function dockRowId(index: number): string {
  return `dock-row-${index}`;
}

/** Classes for a row: highlighted when picked with the arrows. */
export function dockRowClass(picked: boolean): string {
  return picked ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-surface-raised';
}
