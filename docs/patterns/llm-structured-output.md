# Pattern: LLM structured output

**Use when:** you need typed data from a model (extraction, command interpretation, weekly findings).

## Shape

```ts
// packages/core/src/extraction/extract.ts (illustrative)
export async function extract(input: ExtractionInput, deps: LlmDeps): Promise<Result<ExtractionResult, LlmError>> {
  const model = createModel(deps.slots.extraction, deps);
  const prompt = extractionPromptV1;                     // versioned prompt module
  const run = startRun(deps, 'extraction', input.rawLogId);

  const first = await generateStructured(model, {       // thin wrapper over the AI SDK's object-output API
    schema: extractionResultSchema,
    system: prompt.system,
    prompt: prompt.buildUser(input),
    temperature: 0,
    abortSignal: AbortSignal.timeout(deps.slots.extraction.timeoutMs),
  });
  if (first.ok) return run.finish(ok(first.value));

  if (first.error.code === 'llm_invalid_output') {      // one repair attempt
    const repaired = await generateStructured(model, { …, prompt: prompt.buildRepair(input, first.error.details) });
    return run.finish(repaired);
  }
  return run.finish(first);
}
```

- `generateStructured` is the **only** place that calls the AI SDK's object generation; it maps SDK/provider errors to the [error taxonomy](../architecture/llm-engine.md#error-taxonomy) and records token usage. Keeping one wrapper isolates us from AI SDK API changes between major versions.
- The model's output is **never trusted** beyond the schema: run the normalizers (tags, metrics, dates, projects, entities) before writing anything.

## Schema guidelines

- Required + nullable instead of optional for strict providers.
- No open-ended `record<any>` at top level; use known optional keys + `extra: [{key, value}]`.
- Arrays have sensible `max` (activities ≤ 10, tasks ≤ 10, tags ≤ 8).
- Enums for every closed set; `.describe()` short and precise.
- Keep schemas in `packages/core/src/schemas/` and reuse their inferred types downstream.

## Pitfalls

- Letting the model decide explicit `#tags` or IDs — those are deterministic.
- Asking for dates without giving the anchor date + timezone.
- Changing a prompt without bumping its version (breaks fixture comparability and re-extraction).
