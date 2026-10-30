export { buildCaptureInput } from './capture';
export {
  EXTRACTION_PROMPT_VERSION,
  type ExtractionOptions,
  extractRawLog,
  processRawLog,
} from './extraction/extract';
export {
  buildExtractionInput,
  type ExtractionInput,
  type ExtractionVocabulary,
  loadVocabulary,
} from './extraction/input';
export {
  LLM_MAY_CREATE_SETTING,
  type LlmMayCreate,
  llmMayCreateSchema,
  normalizeExtraction,
} from './extraction/normalize';
export { type ExtractionResult, extractionResultSchema } from './extraction/schema';
export {
  generateStructured,
  type LlmDeps,
  type LlmRun,
  type StructuredRequest,
  type StructuredResult,
} from './llm/generate-structured';
export { MODEL_PRESETS, type ModelPreset, modelPresetSchema } from './models/presets';
export { type ParsedCapture, parseCaptureText } from './normalize/capture-text';
export { METRIC_ALIASES, METRICS, type MetricSpec } from './normalize/metric-keys';
export {
  type Exercise,
  type MetricIssue,
  type NormalizedMetrics,
  normalizeMetrics,
  parseQuantity,
  toSnakeKey,
} from './normalize/metrics';
export { normalizeTagPath, normalizeTagSegment, singularize } from './normalize/tags';
export type { ModelContext, ProviderAdapter } from './providers/adapter';
export {
  extractionChain,
  LLM_PROVIDERS,
  type LlmProvider,
  type ModelConfig,
  type ModelSlots,
  modelConfigSchema,
  modelSlotsSchema,
} from './providers/config';
export { LLM_ERROR_CODES, type LlmErrorCode, toLlmError } from './providers/errors';
export {
  apiKeySecretName,
  createModel,
  PROVIDER_ADAPTERS,
  type ProviderDeps,
} from './providers/registry';
