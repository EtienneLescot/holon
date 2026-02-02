/**
 * Credentials Store
 * 
 * Manages API credentials for various providers (OpenAI, Anthropic, etc.).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface CredentialsStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly credentials: Record<string, Record<string, string>>;
  readonly isModalOpen: boolean;
  readonly currentProvider: string;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    // Credentials management
    setCredentials: (provider: string, creds: Record<string, string>) => void;
    getCredentials: (provider: string) => Record<string, string> | undefined;
    clearCredentials: (provider: string) => void;
    
    // Modal management
    openModal: (provider: string) => void;
    closeModal: () => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    hasCredentials: (provider: string) => boolean;
    getProviders: () => string[];
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useCredentialsStore = create<CredentialsStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      credentials: {},
      isModalOpen: false,
      currentProvider: 'openai',
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        setCredentials: (provider, creds) => set((state) => {
          state.credentials[provider] = creds;
        }, false, 'credentials/set'),
        
        getCredentials: (provider) => {
          return get().credentials[provider];
        },
        
        clearCredentials: (provider) => set((state) => {
          delete state.credentials[provider];
        }, false, 'credentials/clear'),
        
        openModal: (provider) => set(
          { isModalOpen: true, currentProvider: provider },
          false,
          'credentials/openModal'
        ),
        
        closeModal: () => set(
          { isModalOpen: false },
          false,
          'credentials/closeModal'
        ),
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        hasCredentials: (provider) => {
          const creds = get().credentials[provider];
          return Boolean(creds && Object.keys(creds).length > 0);
        },
        getProviders: () => Object.keys(get().credentials),
      },
    })),
    { name: 'Credentials Store' }
  )
);
