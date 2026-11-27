# 0013 — Biome for TS lint and format

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
We need consistent formatting and linting across four TS packages and three apps with minimal configuration.

## Decision
Use Biome (one fast tool for formatting, linting and import sorting) at the repo root. Rust uses rustfmt + clippy.

## Alternatives considered
- **ESLint + Prettier** — larger ecosystem (e.g. `eslint-config-expo`, React hooks plugin, import-boundary plugins) but two tools and slower.

## Consequences
- Package-boundary rules: use Biome's restricted-imports rule where it is enough; otherwise add `dependency-cruiser` as a CI check. *Update 2026-11-28 (v0.6.0 Day 2):* Biome's `noImportCycles` catches import cycles, and the direction between packages is a small script run by `pnpm lint` (`tooling/scripts/check-package-imports.ts`), because Biome's restricted imports can't give each package its own list without repeating the platform rules; no `dependency-cruiser`.
- If a critical ESLint-only rule is needed later (e.g. React hooks exhaustive deps if Biome lacks parity), add ESLint narrowly for that rule.
