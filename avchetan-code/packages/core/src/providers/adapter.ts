import type { HttpFetch, LlmError } from '@avchetan/shared';
import type { APICallError, EmbeddingModel, LanguageModel } from 'ai';
import type { LlmProvider, ModelConfig } from './config';

export type ModelContext = {
  /** Empty for providers that don't need a key. */
  apiKey: string;
  fetch: HttpFetch;
};

/**
 * Everything the app needs to know about one provider. The AI SDK already unifies how models
 * are called, so an adapter covers only what still differs. Adding a provider means one new
 * adapter file plus its entry in `PROVIDER_ADAPTERS`.
 */
export type ProviderAdapter = {
  readonly id: LlmProvider;
  readonly label: string;
  readonly requiresApiKey: boolean;
  /** No key is required, but a saved one is sent (an OpenAI-compatible service may want one). */
  readonly optionalApiKey?: boolean;
  /** The user types the service's address (`baseUrl`); there is no default. */
  readonly needsBaseUrl?: boolean;
  /**
   * Not yet tried against the real service with a real key: the apps label it *Preview*
   * (docs/roadmap.md, v0.2.0). Remove once a live run passes.
   */
  readonly preview?: boolean;
  /** Runs on the user's own hardware, so it keeps working with no internet. */
  readonly local: boolean;
  /** The free tier may use submitted content to improve the provider's products. */
  readonly freeTierUsesContent: boolean;
  /** Sent with structured calls, keyed by SDK provider name. */
  readonly structuredOptions?: Record<string, Record<string, string>>;
  /** Sent with Ask, keyed by SDK provider name. */
  readonly analysisOptions?: Record<string, Record<string, string>>;
  createModel(config: ModelConfig, context: ModelContext): LanguageModel;
  /** For search by meaning. Absent when the provider offers no embedding models. */
  createEmbeddingModel?(config: ModelConfig, context: ModelContext): EmbeddingModel;
  /** Provider-specific failures the shared mapping would misread. */
  classifyError?(error: APICallError): LlmError | undefined;
};
