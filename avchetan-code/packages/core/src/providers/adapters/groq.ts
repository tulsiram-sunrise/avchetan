import { createGroq } from '@ai-sdk/groq';
import type { ProviderAdapter } from '../adapter';

export const groqAdapter: ProviderAdapter = {
  id: 'groq',
  label: 'Groq',
  requiresApiKey: true,
  local: false,
  freeTierUsesContent: false,
  createModel: ({ model }, { apiKey, fetch }) => createGroq({ apiKey, fetch })(model),
};
