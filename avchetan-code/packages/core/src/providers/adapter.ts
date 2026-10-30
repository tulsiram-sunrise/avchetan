import type { HttpFetch, LlmError } from '@avchetan/shared';
import type { APICallError, LanguageModel } from 'ai';
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
  /** Runs on the user's own hardware, so it keeps working with no internet. */
  readonly local: boolean;
  /** The free tier may use submitted content to improve the provider's products. */
  readonly freeTierUsesContent: boolean;
  createModel(config: ModelConfig, context: ModelContext): LanguageModel;
  /** Provider-specific failures the shared mapping would misread. */
  classifyError?(error: APICallError): LlmError | undefined;
};
