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
- Package-boundary rules: use Biome's restricted-imports rule where it is enough; otherwise add `dependency-cruiser` as a CI check.
- If a critical ESLint-only rule is needed later (e.g. React hooks exhaustive deps if Biome lacks parity), add ESLint narrowly for that rule.
