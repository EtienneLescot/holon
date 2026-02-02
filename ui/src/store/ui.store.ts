/**
 * UI Store
 * 
 * Manages UI state: selections, modals, and user interactions.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface PromptModalState {
  nodeId: string;
  title: string;
  prompt: string;
}

export interface UIStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly selectedNodeId: string | null;
  
  // AI Modal
  readonly aiModalNodeId: string | null;
  readonly aiInstruction: string;
  
  // Prompt Modal
  readonly promptModal: PromptModalState | null;
  
  // Node Search Modal (new)
  readonly isNodeSearchOpen: boolean;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    // Selection
    selectNode: (nodeId: string | null) => void;
    
    // AI Modal
    openAiModal: (nodeId: string) => void;
    closeAiModal: () => void;
    setAiInstruction: (instruction: string) => void;
    
    // Prompt Modal
    openPromptModal: (state: PromptModalState) => void;
    closePromptModal: () => void;
    
    // Node Search Modal
    openNodeSearch: () => void;
    closeNodeSearch: () => void;
    toggleNodeSearch: () => void;
    
    // Bulk
    reset: () => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    hasSelection: () => boolean;
    isAiModalOpen: () => boolean;
    isPromptModalOpen: () => boolean;
    canSubmitAi: () => boolean;
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useUIStore = create<UIStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      selectedNodeId: null,
      aiModalNodeId: null,
      aiInstruction: '',
      promptModal: null,
      isNodeSearchOpen: false,
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        selectNode: (nodeId) => set(
          { selectedNodeId: nodeId },
          false,
          'ui/selectNode'
        ),
        
        openAiModal: (nodeId) => set(
          { aiModalNodeId: nodeId, aiInstruction: '' },
          false,
          'ui/openAiModal'
        ),
        
        closeAiModal: () => set(
          { aiModalNodeId: null, aiInstruction: '' },
          false,
          'ui/closeAiModal'
        ),
        
        setAiInstruction: (instruction) => set(
          { aiInstruction: instruction },
          false,
          'ui/setAiInstruction'
        ),
        
        openPromptModal: (state) => set(
          { promptModal: state },
          false,
          'ui/openPromptModal'
        ),
        
        closePromptModal: () => set(
          { promptModal: null },
          false,
          'ui/closePromptModal'
        ),
        
        openNodeSearch: () => set(
          { isNodeSearchOpen: true },
          false,
          'ui/openNodeSearch'
        ),
        
        closeNodeSearch: () => set(
          { isNodeSearchOpen: false },
          false,
          'ui/closeNodeSearch'
        ),
        
        toggleNodeSearch: () => set((state) => {
          state.isNodeSearchOpen = !state.isNodeSearchOpen;
        }, false, 'ui/toggleNodeSearch'),
        
        reset: () => set(
          {
            selectedNodeId: null,
            aiModalNodeId: null,
            aiInstruction: '',
            promptModal: null,
            isNodeSearchOpen: false,
          },
          false,
          'ui/reset'
        ),
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        hasSelection: () => get().selectedNodeId !== null,
        isAiModalOpen: () => get().aiModalNodeId !== null,
        isPromptModalOpen: () => get().promptModal !== null,
        canSubmitAi: () => get().aiInstruction.trim().length > 0,
      },
    })),
    { name: 'UI Store' }
  )
);
