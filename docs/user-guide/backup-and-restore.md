# Back up and restore

> Draft — describes planned behavior.

Your data is already stored in more than one place: every device keeps a full copy, and the hub or server keeps one too. Backups protect you against mistakes and broken disks.

## Automatic backups

- **Desktop:** a copy of the local database every day; the last 7 are kept. **Settings → Backups** shows where they are.
- **Home Hub:** a snapshot of the hub data every night; the last 7 are kept.
- **Cloud server:** nightly database dump (configured in the cloud guide).

Tip: point the backup folder at a cloud-synced folder (OneDrive, Google Drive) or an external drive.

## Export your data

**Settings → Export** saves everything as JSON (and CSV per type) — readable without Avchetan. API keys are never included.

## Restore

- **A device broke:** install Avchetan on the new device and pair it. Everything downloads from the hub or server.
- **The hub broke:** set up a new hub, then **Settings → Hub → Restore from backup**. Or start an empty hub and pair your devices: they upload everything they hold.
- **Restore a single device from a backup file:** **Settings → Backups → Restore** (the current data is backed up first).
