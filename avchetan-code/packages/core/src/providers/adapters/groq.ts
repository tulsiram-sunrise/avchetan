import { createGroq } from '@ai-sdk/groq';
import type { ProviderAdapter } from '../adapter';

export const groqAdapter: ProviderAdapter = {
  id: 'groq',
  label: 'Groq',
  requiresApiKey: true,
  local: false,
  freeTierUsesContent: false,
  // Reasoning tokens count against the free tier's per-minute limit.
  structuredOptions: { groq: { reasoningEffort: 'low' } },
  createModel: ({ model }, { apiKey, fetch }) => createGroq({ apiKey, fetch })(model),
};
