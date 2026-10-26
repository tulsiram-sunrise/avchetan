# 0015 — Dynamic categories: LLM-determined and user-defined

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The original spec used a fixed enum (`workout`, `work`, `diet`, `reflection`, `health`). The user wants categories to be **determined automatically by the LLM** and also **definable by the user**. Open question Q4.

## Decision
- Categories become a synced table `categories` (see [data-model](../architecture/data-model.md#categories)); `activities.category_id` (required) and `tasks.category_id` (optional) reference it.
- Seed categories (`workout`, `work`, `diet`, `health`, `reflection`, `other`) are created on first run with deterministic IDs `derivedId('category', slug)`, so every device shares them. Seeds can be renamed or archived, not deleted; `other` and `reflection` are required (fallback and system briefs).
- The extraction prompt receives the current category list (name + description). For each item the LLM **picks an existing category** or **proposes a new one** (`name` + one-line `description`).
- Guardrails on LLM-created categories:
  - the normalizer first matches the proposal to existing categories (slug equality, singular/plural, synonym map, merged aliases);
  - at most one new category per raw log;
  - created with `origin = 'llm'`, `needs_review = true`; the UI shows "New category: *Meditation* — keep / rename / merge into…";
  - setting `categories.llmMayCreate`: `auto` (default) | `suggest` (item goes to `other` and the suggestion is stored for review) | `off`.
- Users can create, rename, recolor, merge (`merged_into_id`, readers follow it), and archive categories; editing an item's category marks it user-edited and records a correction.

## Alternatives considered
- **Fixed enum** (previous leaning) — simplest, but rejected by the user.
- **Categories as top-level tags** — blurs the "one primary category per item" model that dashboards and streaks rely on.

## Consequences
- The extraction schema uses a string for the category instead of an enum; validation moves from the schema to the normalizer.
- Category vocabulary must stay small: the prompt asks the model to prefer existing ones, and review/merge tools are part of Phase 3.
- Two devices creating the same new category offline converge, because the ID is derived from the normalized slug.
