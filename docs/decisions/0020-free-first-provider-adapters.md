# 0020 — Free providers first, behind small provider adapters

- **Status:** Accepted
- **Date:** 2026-10-30

## Context
Phase 3 planned six providers. The author wants the first working version to depend only on free options, with paid providers added later. A fixed `switch` in `createModel` would also have grown a branch for every provider-specific difference, and some differences are not about calling the model at all:

- Gemini answers a bad API key with HTTP 400 `INVALID_ARGUMENT` (reason `API_KEY_INVALID`), not 401. The shared error mapping would read that as `llm_unavailable` and keep retrying.
- The pending processor must know which providers still work with no internet.
- Free tiers treat data differently. Google's terms say content sent to its unpaid services is used to improve its products, may be read by human reviewers, and that sensitive, confidential or personal information must not be submitted. Avchetan's content is personal by nature.

The Vercel AI SDK ([ADR-0008](0008-vercel-ai-sdk-provider-agnostic.md)) already unifies how models are called, so a second call abstraction would add nothing.

## Decision
- **Providers for now: `groq`, `ollama`, `google`.** `anthropic`, `openai` and `openai_compatible` move to *Later* on the roadmap; their packages are removed until then.
- **Adapter pattern.** Each provider is one `ProviderAdapter` in `packages/core/src/providers/adapters/`, listed in `PROVIDER_ADAPTERS`. An adapter holds only what differs: whether a key is required, whether it is local, whether its free tier uses content, how to build the SDK model, and an optional `classifyError` for failures the shared mapping would misread. `generateStructured` and the rest of the app know nothing provider-specific.
- **Gemini's free tier is for development with made-up data only.** It is not offered as an automatic fallback, because a fallback would send real entries to it silently. Settings must warn before it is selected for real entries.

## Consequences
- Adding a provider is one adapter file plus one registry line. The `Record<LlmProvider, ProviderAdapter>` type makes a missing adapter a compile error.
- Rule 13 (works with zero paid services) now holds from the first version, on Groq's free tier or Ollama.
- The free-tier list is narrower than the [LLM engine](../architecture/llm-engine.md) plan until the paid adapters are added.
- Terms change. `freeTierUsesContent` reflects the providers' published terms as of this date and must be rechecked at each release.
