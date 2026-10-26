# 0008 — Vercel AI SDK; model IDs are configuration

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The user wants to choose between the major LLM providers and models (Gemini, Claude, OpenAI, Groq, Ollama, …) per purpose, and to bring their own keys. Model names change often; the names in the original documents are already outdated.

## Decision
- Use the Vercel AI SDK (`ai` + `@ai-sdk/*` providers, OpenAI-compatible provider for Ollama/others) inside `packages/core` only.
- Wrap SDK calls in our own thin functions (`generateStructured`, `runAnalysis`, `embedText`) so SDK major-version changes touch one place.
- Model slots (`extraction`, `analysis`, `embedding`, `transcription`) are user settings; suggested defaults live in a data file (`presets.json`), never in code.
- LLM calls go directly from each node to the provider (BYOK), with an injected `fetch`.

## Alternatives considered
- **LangChain/LangGraph** — heavier abstraction than needed.
- **LiteLLM (Python)** — would require a Python service.
- **Hand-written provider adapters** — the original discussion explicitly warned against this.

## Consequences
- Provider differences in structured-output strictness → follow the schema guidelines in [patterns/llm-structured-output.md](../patterns/llm-structured-output.md).
- Must verify the SDK on Hermes (mobile) and through the Tauri HTTP fetch.
