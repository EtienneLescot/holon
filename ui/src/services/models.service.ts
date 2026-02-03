/**
 * Models Service
 * 
 * Fetches and caches available models from provider APIs.
 * For OpenAI, we fetch from their models endpoint.
 */

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  context_window?: number;
}

export interface ProviderModels {
  provider: string;
  models: ModelInfo[];
  lastFetched: number;
}

const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours
const CACHE_KEY_PREFIX = 'holon_models_';

/**
 * Fetch available models for OpenAI
 */
async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  console.log('[Models Service] Fetching OpenAI models with API key:', apiKey ? '***' + apiKey.slice(-4) : 'NO KEY');
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error('[Models Service] OpenAI API error:', response.status, response.statusText);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[Models Service] Received', data.data?.length || 0, 'models from OpenAI');
    
    // Filter to only chat completion models and sort by ID
    const chatModels = data.data
      .filter((model: any) => 
        model.id.includes('gpt') || 
        model.id.includes('o1') ||
        model.id.includes('o3')
      )
      .map((model: any) => ({
        id: model.id,
        name: model.id,
        description: model.id,
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));

    console.log('[Models Service] Filtered to', chatModels.length, 'chat models');
    return chatModels;
  } catch (error) {
    console.error('[Models Service] Failed to fetch OpenAI models:', error);
    throw error;
  }
}

/**
 * Get cached models from localStorage
 */
function getCachedModels(provider: string): ProviderModels | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${provider}`);
    if (!cached) return null;

    const data: ProviderModels = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is still valid
    if (now - data.lastFetched < CACHE_DURATION) {
      return data;
    }

    // Cache expired
    localStorage.removeItem(`${CACHE_KEY_PREFIX}${provider}`);
    return null;
  } catch (error) {
    console.error('Failed to read cached models:', error);
    return null;
  }
}

/**
 * Save models to localStorage cache
 */
function cacheModels(provider: string, models: ModelInfo[]): void {
  try {
    const data: ProviderModels = {
      provider,
      models,
      lastFetched: Date.now(),
    };
    localStorage.setItem(`${CACHE_KEY_PREFIX}${provider}`, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to cache models:', error);
  }
}

/**
 * Fetch models for a given provider with caching
 */
export async function fetchModels(provider: string, apiKey?: string): Promise<ModelInfo[]> {
  console.log('[Models Service] fetchModels called for provider:', provider, 'has API key:', !!apiKey);
  
  // Check cache first
  const cached = getCachedModels(provider);
  if (cached) {
    console.log('[Models Service] Using cached models:', cached.models.length);
    return cached.models;
  }

  // Fetch fresh data
  let models: ModelInfo[];

  switch (provider.toLowerCase()) {
    case 'openai':
      if (!apiKey) {
        console.warn('[Models Service] No API key provided, using default models');
        throw new Error('API key required to fetch OpenAI models');
      }
      models = await fetchOpenAIModels(apiKey);
      break;

    // Add more providers here in the future
    // case 'anthropic':
    //   models = await fetchAnthropicModels(apiKey);
    //   break;

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  // Cache the results
  cacheModels(provider, models);
  console.log('[Models Service] Cached', models.length, 'models for', provider);

  return models;
}

/**
 * Get cached models only - no default/invented models
 */
export function getDefaultModels(provider: string): ModelInfo[] {
  // No default models - must fetch from API
  return [];
}

/**
 * Clear cached models for a provider
 */
export function clearModelCache(provider?: string): void {
  if (provider) {
    localStorage.removeItem(`${CACHE_KEY_PREFIX}${provider}`);
  } else {
    // Clear all model caches
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  }
}
