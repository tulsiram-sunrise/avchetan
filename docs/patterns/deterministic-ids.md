# Pattern: Deterministic IDs for derived rows

**Use when:** a row's identity is a function of other data, and the same logical row may be produced more than once (retries, re-extraction, two devices or device + server processing the same log, two devices creating the same tag offline, two devices generating the same daily brief).

**Why:** with random IDs those cases create duplicates that LWW cannot merge. With deterministic IDs they produce the *same* primary key, and LWW collapses them into one row.

## Recipes

| Row | ID |
|---|---|
| Extracted activity | `derivedId('activity', rawLogId, ordinal)` |
| Extracted task | `derivedId('task', rawLogId, ordinal)` |
| Tag | `derivedId('tag', tagPath)` |
| Tag link | `derivedId('entity_tag', tagId, targetType, targetId)` |
| Entity | `derivedId('entity', kind, normalizedName)` |
| Mention | `derivedId('mention', entityId, targetType, targetId, role)` |
| Daily brief | `derivedId('daily-brief', localDate)` |
| Weekly review | `derivedId('weekly-review', isoWeek)` |

`derivedId` = UUIDv5(`DHYAN_NAMESPACE`, parts joined with `\u001f`).

## Re-extraction

Ordinals can shift when the model output changes. The pipeline therefore: upserts the new set, then soft-deletes previous `origin='extraction'` rows of that raw log whose IDs are not in the new set, skipping `is_user_edited` rows. Net effect: the derived set exactly matches the latest extraction, plus any rows the user edited.

## Pitfalls

- Including mutable data (titles, timestamps) in the parts → IDs change on edit. Use only identity-defining inputs.
- Normalization must happen **before** deriving (`Shoulder Pain` and `shoulder-pain` must give the same tag ID).
- Tag rename: the path changes but the ID must not → rename updates `path`/`name` on the existing row; `derivedId('tag', path)` is only used when **creating**. Lookup is by path first, so a renamed tag is still found. Creating a tag whose derived ID already exists as a tombstone → resurrect it (clear `deleted_at`).
