# Back up and restore

Your data is already stored in more than one place: every device keeps a full copy, and the hub or server keeps one too. Backups protect you against mistakes and broken disks. Exports give you your data in plain files that you can open without Avchetan.

## Automatic backups

- **Windows:** Avchetan copies its database once a day while it runs; the last 7 copies are kept. **Settings → Your data** shows the latest one. **Open backups folder** opens it (`%APPDATA%\app.avchetan\backups`), and **Back up now** makes a fresh copy for today.
- **Android:** the app copies its database once a day when you open it; the last 7 are kept. **More → Your data** shows the latest one and has **Back up now**. These copies live in the app's private storage, so uninstalling the app removes them too. Export from time to time as well (below).
- **Home Hub:** the hub saves a snapshot of its data folder once a day; the last 7 are kept. They go in `pglite-backups` next to the `pglite-data` folder, or in the `hub-backups` volume if the hub runs in Docker.
- **Cloud server:** a nightly database dump (`pg_dump`), set up as part of the cloud guide.

Tip: copy the backups folder to an external drive or a cloud-synced folder (OneDrive, Google Drive) now and then. Don't point a sync tool at `%APPDATA%\app.avchetan` itself (see [database_unavailable](troubleshooting.md#database_unavailable)).

## Export your data

- **Windows:** **Settings → Your data → Export everything**. Avchetan makes a new folder under `Documents\Avchetan exports`, and **Open exports folder** opens it.
- **Android:** **More → Your data → Export everything**, then choose a folder (for example *Downloads*) and tap **Use this folder**. Avchetan makes a new folder there.

Each export folder holds:

- `avchetan-export.json`: every entry and everything organized from it (activities, tasks, tags, people and places, categories, projects), plus your Ask history and the corrections you made.
- One `.csv` file per kind of data, which opens in Excel or Google Sheets.

Deleted entries, settings and API keys are never included.

## Restore

- **A device broke or was replaced:** install Avchetan on the new device and pair it ([Pair your phone](pair-your-phone.md)). Everything downloads from the hub or server.
- **The hub's data was lost:** start an empty hub and pair your devices again. They upload everything they hold. To get the hub's own state back too (its token, its device list, its search index), restore a snapshot:
  1. Stop the hub.
  2. Rename the `pglite-data` folder, for example to `pglite-data-old`.
  3. In the `avchetan-code` folder, run `pnpm --filter @avchetan/server restore:hub apps/server/pglite-backups/hub-2026-11-03.tar.gz`, using the name of the snapshot you want.
  4. Start the hub. Devices keep their pairing, since the token comes back with the snapshot.
- **Put one device back to an earlier day:** not built in yet. A backup file is a normal SQLite database, so any SQLite viewer (such as *DB Browser for SQLite*) can open it to look something up.
