# Performance baseline

Dev-only scripts for measuring the apps with years of made-up history ([finding and using data §7](../../../docs/product/finding-and-using-data.md#7-performance-baseline)). Results go in the [roadmap](../../../docs/roadmap.md#phase-8--finding-and-using-data-v040). Windows only. Never run them against real data.

1. Quit any installed Avchetan (it holds the shortcut and port 8787), and rename `%APPDATA%\app.avchetan.demo` to keep the demo copy you have.
2. `pnpm --filter @avchetan/desktop demo:seed` fills a new demo database with 50,000 made-up entries over three years (`--entries`, `--years`, `--db`). It refuses a database outside an `app.avchetan.demo` folder or one that already has entries. Takes about 3 minutes.
3. `pnpm --filter @avchetan/desktop demo:bench` times the queries behind each page on Node's SQLite, and tries the search index on a copy.
4. Start the demo with the debug port (see [screenshots](../screenshots/README.md#the-demo-copy)), then:
   - `powershell -ExecutionPolicy Bypass -File tooling/perf/measure-hotkey.ps1` times the shortcut to the capture box (main window closed);
   - `node tooling/perf/measure-desktop.ts` times the main window's start and each page's first visit.
5. For sync, turn on **Home Hub on this PC** in the demo: everything seeded is queued, so the whole history uploads; watch `sync_outbox` empty and the hub's memory.

Afterwards, quit the demo and put your old `app.avchetan.demo` folder back.
