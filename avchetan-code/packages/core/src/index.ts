export { type AskRequest, type AskResult, type AskSource, ask } from './analysis/ask';
export type { SearchHistory } from './analysis/tools';
export { buildCaptureInput } from './capture';
export { type EmbeddingSource, embeddingText, embedTexts } from './embeddings/embed';
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
export {
  type ClaimOptions,
  createPendingProcessor,
  type PendingProcessor,
  type PendingProcessorDeps,
} from './extraction/pending-processor';
export { type ExtractionResult, extractionResultSchema } from './extraction/schema';
export {
  ANALYSIS_MODE_SETTING,
  ANALYSIS_MODES,
  type AnalysisMode,
  EXTRACTION_MODE_SETTING,
  type ExtractionSettings,
  loadAnalysisMode,
  loadAnalysisModel,
  loadExtractionMode,
  loadExtractionSettings,
  MODEL_SLOTS_SETTING,
  saveAnalysisMode,
  saveExtractionMode,
} from './extraction/settings';
export {
  generateStructured,
  type LlmDeps,
  type LlmRun,
  type StructuredRequest,
  type StructuredResult,
} from './llm/generate-structured';
export { testModel } from './llm/test-model';
export { MODEL_PRESETS, type ModelPreset, modelPresetSchema } from './models/presets';
export {
  hasApiKey,
  loadSlotModel,
  type ModelSlot,
  removeApiKey,
  saveSlotModel,
  testDraftModel,
} from './models/slots';
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
export { exerciseLines, metricsText } from './normalize/metrics-display';
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
  createEmbeddingModel,
  createModel,
  PROVIDER_ADAPTERS,
  type ProviderDeps,
} from './providers/registry';
