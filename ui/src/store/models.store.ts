/**
 * Models Store
 * 
 * Manages available models for each provider with automatic caching and fetching.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { fetchModels, getDefaultModels, clearModelCache, type ModelInfo } from '../services/models.service';

// ============================================================================
// Types
// ============================================================================

export interface ModelsStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly models: Record<string, ModelInfo[]>;
  readonly loading: Record<string, boolean>;
  readonly errors: Record<string, string | null>;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    // Models management
    loadModels: (provider: string, apiKey?: string) => Promise<void>;
    getModels: (provider: string) => ModelInfo[];
    clearCache: (provider?: string) => void;
    setModels: (provider: string, models: ModelInfo[]) => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    isLoading: (provider: string) => boolean;
    getError: (provider: string) => string | null;
    hasModels: (provider: string) => boolean;
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useModelsStore = create<ModelsStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      models: {},
      loading: {},
      errors: {},
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        loadModels: async (provider, apiKey) => {
          console.log('[Models Store] loadModels called for:', provider, 'with API key:', !!apiKey);
          
          // Set loading state
          set((state) => {
            state.loading[provider] = true;
            state.errors[provider] = null;
          }, false, 'models/loadModels/start');

          try {
            // Fetch from API - no fallback to fake models
            const models = await fetchModels(provider, apiKey);
            console.log('[Models Store] Successfully fetched', models.length, 'models from API');

            // Update models
            set((state) => {
              state.models[provider] = models;
              state.loading[provider] = false;
            }, false, 'models/loadModels/success');

          } catch (error) {
            // If API fails, set error and empty models
            console.error('[Models Store] Failed to fetch models:', error);
            set((state) => {
              state.loading[provider] = false;
              state.errors[provider] = error instanceof Error ? error.message : 'Failed to fetch models';
              state.models[provider] = [];
            }, false, 'models/loadModels/failed');
          }
        },

        getModels: (provider) => {
          // Return cached models only - no invented defaults
          return get().models[provider] || [];
        },

        clearCache: (provider) => {
          clearModelCache(provider);
          if (provider) {
            set((state) => {
              delete state.models[provider];
              delete state.errors[provider];
            }, false, 'models/clearCache/single');
          } else {
            set({ models: {}, errors: {} }, false, 'models/clearCache/all');
          }
        },

        setModels: (provider, models) => {
          set((state) => {
            state.models[provider] = models;
          }, false, 'models/setModels');
        },
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        isLoading: (provider) => {
          return get().loading[provider] || false;
        },
        
        getError: (provider) => {
          return get().errors[provider] || null;
        },
        
        hasModels: (provider) => {
          const models = get().models[provider];
          return Boolean(models && models.length > 0);
        },
      },
    })),
    { name: 'Models Store' }
  )
);
