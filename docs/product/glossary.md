# Glossary

| Term | Meaning |
|---|---|
| **Capture** | Saving a user's free-text (or transcribed voice) entry as a raw log. Always local, always instant. |
| **Raw log** | The verbatim captured text plus metadata (`raw_logs` row). Never modified after capture except status/processing fields. |
| **Extraction** | LLM pass that turns a raw log into activities, tasks, tags and entity mentions. |
| **Derived rows** | Rows produced from a raw log by extraction (activities, tasks, tag links, mentions). IDs are deterministic. |
| **Activity** | Something that happened: workout, work block, meal, reflection, health event. Has a category, title, metrics, `logged_date`. |
| **Task** | Something to do: to-do, reminder, commitment. Has optional `due_date`, `completed_at`. |
| **Metric** | Key/value number or fact on an activity (`duration_min: 45`). Keys come from the metric key registry. |
| **Category** | Primary classification of an activity (optional for tasks). Dynamic: seeded defaults, LLM-proposed, user-defined. One per item. |
| **Project** | Coarse area of responsibility (Fitness, Engineering). Optional single assignment per activity/task. |
| **Tag** | Hierarchical, cross-cutting label. **Explicit** = user typed `#tag`; **inferred** = LLM proposed. |
| **Entity** | A person, place, organization, exercise, food… referenced by logs. Linked via **mentions**. |
| **Commitment** | A task with an `owed_to` person mention. |
| **Dock** | The desktop floating capture/ask/command window. |
| **Full window** | The normal desktop window for timeline, tasks, settings. |
| **Model slot** | A configured (provider, model) pair for a purpose: *extraction*, *analysis*, *embedding*, *transcription*. |
| **Provider** | An LLM vendor/runtime: groq, ollama, google. More are planned ([ADR-0020](../decisions/0020-free-first-provider-adapters.md)). |
| **Outbox** | Local table of records changed since the last successful push. |
| **Push / Pull** | Upload local changes / download server changes. Together: a **sync cycle**. |
| **Cursor** | Server-issued position (`server_seq`) up to which a device has pulled. |
| **LWW** | Last-Write-Wins: the version with the greater `(updated_at, updated_by_device)` wins. |
| **Tombstone** | A row with `deleted_at` set (soft delete); it syncs like any other change. |
| **Origin device** | The device that captured a raw log; it has first right to process it. |
| **Lease** | A time-limited claim (`processing_lease_until`) that prevents two workers processing the same log. |
| **Fallback extraction** | Server processing a raw log that its origin device hasn't processed within the grace period. |
| **Ask mode** | `?`-prefixed query answered by the analysis model; read-only. |
| **Command mode** | `/`-prefixed action. |
| **Daily brief** | Automated 4-bullet evening summary, stored as a reflection activity. |
| **Deployment mode** | *Standalone* (no server), *Home Hub* (server + Ollama on the user's PC), *Cloud* (hosted server). |
| **Hub** | The user's PC running the Avchetan server (and usually Ollama) in Home Hub mode. |
| **Pairing** | Connecting a device to a server by scanning a QR code with server URLs + token. |
| **Delegate (extraction)** | Slot mode where a device doesn't extract itself; the server processes its logs immediately. |
| **Hub (analysis)** | Slot mode where Ask questions run on the server via `/v1/ask`. |
