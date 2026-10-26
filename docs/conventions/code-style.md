# Code Style

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`. Shared base in `tooling/tsconfig.base.json`.
- ESM everywhere (`"type": "module"`). Workspace packages are consumed as **source** (`exports` → `./src/*.ts`); no build step for internal packages except the server bundle.
- **No `any`.** Use `unknown` + Zod parse. `as` casts only with a comment explaining why they're safe.
- Types come from Zod schemas (`z.infer`) or Drizzle (`$inferSelect`/`$inferInsert`); don't hand-write duplicates.
- Prefer `type` over `interface` except for adapter contracts meant to be implemented (`interface SecretStore`).
- Named exports only. Default exports only where required (Expo Router routes, `*.config.ts`).
- One concept per file; files ≤ ~300 lines — split when they grow.
- `index.ts` barrels only at package roots (public API). Inside a package import by path.
- Pure functions for logic (normalization, LWW compare, date resolution) — easy to test. Side effects at the edges (repositories, adapters, workers).
- `async`/`await`, never raw `.then` chains. Never leave a floating promise — `void fn()` with a comment if fire-and-forget is intended (e.g. `void sync.schedule()` after capture).
- Dates: never `new Date()` for persisted values; use `clock` from `@avchetan/shared` ([time-and-ids](time-and-ids.md)).
- Comments explain *why*, not *what*. Public package APIs get a one-line TSDoc.

## React (desktop + mobile)

- Function components + hooks. Component files export one component, `PascalCase` name, file `kebab-case.tsx`.
- Data reads via TanStack Query hooks in `src/queries/*` (`useTodayTimeline`, `useOpenTasks`); writes via mutation hooks that call repositories. Components never touch the DB directly.
- UI state (dock mode, draft, panel open) in Zustand stores in `src/stores/*`.
- Query invalidation keys are table names (`['tasks', …]`); the `logs:changed` / `sync:done` events invalidate by table.
- Tailwind (desktop) / NativeWind (mobile) with shared design tokens (colors, spacing, radii) from `@avchetan/shared/tokens`.
- Accessibility: every interactive element keyboard-reachable on desktop; labels on icon buttons.

## Rust (`apps/desktop/src-tauri`)

- `rustfmt` default config, `clippy -D warnings` in CI.
- Thin: no business logic. Each command in `commands/<area>.rs`, returns `Result<T, CommandError>`.
- No `unwrap()`/`expect()` outside `setup` initialization; errors map to `CommandError { code, message }`.
- Platform-specific code behind `#[cfg(target_os = "...")]` with a stub for other OSes.

## Formatting & lint

- **Biome** for TS/JS/JSON/YAML formatting and linting ([ADR-0013](../decisions/0013-biome-for-lint-and-format.md)): 2-space indent, single quotes, semicolons, trailing commas, line width 100. Markdown, `pnpm-lock.yaml` and generated migrations are excluded.
- Package boundaries are enforced by Biome's `noRestrictedImports` on `packages/**/src` (no `node:*`, `@tauri-apps/*`, `expo*`, `react-native*`, or app imports; tests are exempt).
- Import order: node/builtins, external, `@avchetan/*`, relative — Biome organizes imports.
- `pnpm lint` and `pnpm typecheck` must pass before commit (enforced by a pre-commit hook via `lefthook`, and CI).

## Dependencies

- Add dependencies to the narrowest workspace that needs them.
- Prefer well-maintained, small libraries; no new state/ORM/validation libraries beyond the chosen stack without an ADR.
- Pin exact versions (`saveExact: true` in `pnpm-workspace.yaml`); update deliberately.
- Dependency install scripts are blocked unless allowed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>`); allow only what needs it.
