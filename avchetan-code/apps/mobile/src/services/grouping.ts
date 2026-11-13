/** Rows extracted from each raw log. */
export function byRawLog<T extends { rawLogId: string | null }>(
  rows: readonly T[] | undefined,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows ?? []) {
    if (row.rawLogId) groups.set(row.rawLogId, [...(groups.get(row.rawLogId) ?? []), row]);
  }
  return groups;
}
