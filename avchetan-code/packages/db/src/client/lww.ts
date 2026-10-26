/** Version of a synced row: Last-Write-Wins key (docs/architecture/sync-protocol.md). */
export type RowVersion = { updatedAt: string; updatedByDevice: string };

/**
 * Compares two row versions: positive if `a` is newer, negative if older, 0 if equal.
 * `updatedAt` strings share one fixed format, so string order is time order; the device
 * ID breaks ties deterministically on every node.
 */
export function compareVersions(a: RowVersion, b: RowVersion): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (a.updatedByDevice !== b.updatedByDevice)
    return a.updatedByDevice > b.updatedByDevice ? 1 : -1;
  return 0;
}
