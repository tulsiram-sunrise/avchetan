export { type AskRequest, type AskResult, type AskSource, ask } from './analysis/ask';
export {
  BRIEF_ENABLED_SETTING,
  BRIEF_FAILURE_SETTING,
  BRIEF_TIME_SETTING,
  type BriefFailure,
  type BriefMaker,
  type BriefRunner,
  type BriefRunnerDeps,
  type BriefSettings,
  briefFailureSchema,
  createBriefRunner,
  DEFAULT_BRIEF_TIME,
  dueBriefDays,
  loadBriefFailure,
  loadBriefSettings,
  localTimeSchema,
  saveBriefFailure,
  saveBriefSettings,
} from './analysis/brief-schedule';
export {
  type BriefText,
  briefNotes,
  briefTextSchema,
  collectBriefFacts,
  DAILY_BRIEF_KIND,
  DAILY_BRIEF_TITLE,
  dailyBriefId,
  entriesSinceBrief,
  findDailyBrief,
  isDailyBrief,
  isFrictionTag,
  type MakeBriefRequest,
  type MakeBriefResult,
  makeDailyBrief,
  mayReadPrivate,
  parseBriefNotes,
} from './analysis/daily-brief';
export type { Candidate, WeekChange, WeekTotals } from './analysis/patterns';
export type { SearchHistory } from './analysis/tools';
export {
  bucketTrend,
  TREND_RANGE_LABELS,
  TREND_RANGES,
  type Trend,
  type TrendAxis,
  type TrendBar,
  type TrendBucket,
  type TrendPoint,
  type TrendRange,
  type TrendSlot,
  type TrendWindow,
  trendAxis,
  trendAxisFor,
  trendBarLabel,
  trendBarTitle,
  trendMax,
  trendSummaryText,
  trendValueText,
  trendWindow,
} from './analysis/trends';
export {
  findWeeklyReview,
  isSunday,
  isWeeklyReview,
  type MakeReviewResult,
  makeWeeklyReview,
  reviewFindings,
  sundayOf,
  WEEKLY_REVIEW_KIND,
  type WeekSummary,
  weekCandidates,
  weekChangesText,
  weeklyReviewId,
  weekSummary,
  weekTotalsText,
} from './analysis/weekly-review';
export { buildCaptureInput } from './capture';
export {
  ASK_PREFIX,
  CAPTURE_MODE_BADGES,
  CAPTURE_MODES,
  type CaptureMode,
  captureMode,
} from './commands/capture-mode';
export { type CommandReading, interpretCommand } from './commands/interpret';
export {
  COMMANDS_ALIASES_SETTING,
  COMMANDS_EXAMPLES_SETTING,
  COMMANDS_LEARN_SETTING,
  type CommandLearning,
  forgetCommandAlias,
  forgetCommandExample,
  type LearnedCommandExample,
  learnFromReading,
  loadCommandLearning,
  MAX_COMMAND_EXAMPLES,
  saveCommandLearn,
} from './commands/learning';
export { matchOpenTask, type TaskMatch } from './commands/match';
export {
  type CommandAliases,
  captureText,
  isCommand,
  type ParsedCommand,
  parseCommand,
} from './commands/parse';
export { rankCommands } from './commands/rank';
export {
  COMMAND_NAMES,
  COMMANDS,
  type CommandName,
  isCommandName,
  LOCK_FREE_COMMANDS,
} from './commands/registry';
export {
  type ClipboardRead,
  clipboardFields,
  clipboardForPrompt,
  clipboardOf,
  clipboardReadSchema,
  cutUtf8,
  type DockClipboard,
  filterClipboard,
  MAX_CLIPBOARD_BYTES,
  PROMPT_CLIPBOARD_BYTES,
} from './context/clipboard';
export {
  CONTEXT_PAUSE_MINUTES,
  CONTEXT_SETTING_KEYS,
  loadContextSettings,
  pauseEnd,
  saveContextSettings,
} from './context/settings';
export {
  appMatches,
  BROWSER_APPS,
  type ContextRuleInput,
  type ContextSettings,
  contextSettingsSchema,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_DENY_LIST,
  type EntryWindowContext,
  filterContext,
  isBrowser,
  isDenied,
  isPaused,
  MAX_WINDOW_TITLE,
  matchRules,
  parseTitlePattern,
  type RuleMatch,
  ruleMatchesOf,
  ruleMatchSchema,
  ruleOutcome,
  type TitlePattern,
  type WindowContext,
  windowContextOf,
  windowContextSchema,
} from './context/window-context';
export { type EmbeddingSource, embeddingText, embedTexts } from './embeddings/embed';
export {
  chooseExamples,
  LEARN_FROM_CORRECTIONS_SETTING,
  loadLearnFromCorrections,
  MAX_EXAMPLES,
  renderExample,
  saveLearnFromCorrections,
} from './extraction/corrections';
export { type DayHint, dayHints } from './extraction/date-check';
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
export { waitsForLocalAi } from './extraction/private';
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
export {
  checkDeviceModels,
  type DeviceModelUse,
  deviceModelRows,
} from './models/device-check';
export {
  findSpeechModel,
  MODEL_PRESETS,
  type ModelPreset,
  modelPresetSchema,
  SPEECH_MODELS,
  type SpeechModel,
  speechModelSchema,
} from './models/presets';
export {
  hasApiKey,
  loadSlotModel,
  type ModelSlot,
  removeApiKey,
  saveSlotModel,
  testDraftModel,
} from './models/slots';
export { type ParsedCapture, parseCaptureText } from './normalize/capture-text';
export type { DayCategory } from './normalize/day-summary';
export {
  calendarDots,
  dayCategories,
  dayCategoryText,
  durationText,
} from './normalize/day-summary';
export {
  applyMetricRows,
  METRIC_CHOICES,
  type MetricChoice,
  type MetricEditResult,
  type MetricRow,
  type MetricRowProblem,
  metricChoice,
  metricChoicesFor,
  metricRows,
  nextMetricKey,
} from './normalize/metric-edit';
export { METRIC_ALIASES, METRICS, type MetricSpec } from './normalize/metric-keys';
export {
  formatMetricAmount,
  type MetricSums,
  type MetricTotal,
  type MetricTotalKind,
  metricLabel,
  metricTotalKind,
  metricTotalText,
  metricUnit,
  topMetricTotals,
} from './normalize/metric-totals';
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
export { checkModels, type ModelCheckDeps } from './providers/model-check';
export {
  listOllamaModels,
  missingOllamaModels,
  type OllamaModels,
  ollamaRoot,
  type PullProgress,
  pullOllamaModel,
} from './providers/ollama-models';
export {
  apiKeySecretName,
  createEmbeddingModel,
  createModel,
  PROVIDER_ADAPTERS,
  type ProviderDeps,
} from './providers/registry';
export {
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  type DatePreset,
  type DateRange,
  presetRange,
} from './search/date-range';
export {
  choiceIsSet,
  type FilterChoice,
  NO_FILTERS,
  toSearchFilters,
} from './search/filters';
export {
  DEFAULT_VOICE_SETTINGS,
  insertDictation,
  loadVoiceSettings,
  SPEECH_LOCALES,
  type SpeechLocale,
  saveVoiceSettings,
  VOICE_SETTING_KEYS,
  type VoiceSettings,
  voiceSettingsSchema,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from './voice/settings';
