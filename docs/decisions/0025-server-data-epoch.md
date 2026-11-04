# 0025 — A data epoch tells devices when a server's data went back in time

- **Status:** Accepted
- **Date:** 2026-11-04

## Context
A device knows its server by `serverId`, and only sends a row once: after the server acknowledges it, the outbox pointer is gone, and the pull cursor moves past what it has seen. That is right while the server keeps everything. It isn't after:
- **A snapshot restore** (`restore:hub`, [backup and restore](../user-guide/backup-and-restore.md)): the server comes back with the same `serverId` and the token, but without what devices sent since the snapshot. Devices don't send those rows again, and their cursors point past the server's newest row, so they also miss what other devices send next until the server's sequence catches up.
- **Moving old data in** (the built-in hub's **Use data from a hub I ran before**, [ADR-0024](0024-hub-sidecar-node-single-executable.md)): the folder chosen can be an older copy, with the same effect.

The guide said devices "keep their pairing" after a restore, which was true but hid the loss. A test reproduces it: a task created after the snapshot never reached a second device.

## Decision
- `server_meta` gets a `data_epoch` (uuid), returned by `/v1/health` as `dataEpoch` (optional in the schema, so older servers still validate).
- The server keeps its epoch across starts. It makes a new one when the column is empty, or when started with `RESET_DATA_EPOCH=true`.
- `restoreSnapshot` empties the column in the restored data. Snapshots from before the column existed get it empty from migration `0004_server_data_epoch`, which has the same effect.
- The desktop app writes a `reset-data-epoch` marker next to the hub's data after moving data in. It starts the hub with `RESET_DATA_EPOCH=true` while the marker exists, and removes it once the hub listens.
- The sync engine saves the epoch with the `serverId` (`sync_state.data_epoch`). A different epoch for the same server is handled like a new server: every row is queued again, the cursor goes back to 0, and the device registers again. A device without a saved epoch saves it without re-sending, so upgrading costs nothing.

## Alternatives considered
- **A new `serverId` on restore:** devices would re-send by the existing rule, but `serverId` also names the server for pairing and the server's own device, so more would change.
- **Comparing the device's cursor with the server's newest sequence:** catches some restores, but not one where other devices pushed enough afterwards to pass the old cursor, and it says nothing about rows the device sent.
- **Telling the user to pair every device again after a restore:** pairing doesn't re-send anything either.

## Consequences
- After a restore or a move, every device uploads its whole history once and downloads everything again. Last write wins and IDs are deterministic, so this converges without duplicates. For one person that's seconds to a minute.
- Moving the current, up-to-date folder in also costs that one re-sync, which is accepted: the app can't tell a current copy from an old one.
