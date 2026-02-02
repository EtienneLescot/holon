/**
 * Execution Store
 * 
 * Manages workflow execution state and results.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly output: Record<string, any> | null;
  readonly isRunning: boolean;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    setOutput: (output: Record<string, any>) => void;
    clearOutput: () => void;
    setRunning: (isRunning: boolean) => void;
    updateNodeOutput: (nodeId: string, output: any) => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    getNodeOutput: (nodeId: string) => any;
    getNodeStatus: (nodeId: string) => 'success' | 'error' | 'pending' | null;
    hasOutput: () => boolean;
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useExecutionStore = create<ExecutionStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      output: null,
      isRunning: false,
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        setOutput: (output) => set(
          { output, isRunning: false },
          false,
          'execution/setOutput'
        ),
        
        clearOutput: () => set(
          { output: null },
          false,
          'execution/clearOutput'
        ),
        
        setRunning: (isRunning) => set(
          { isRunning },
          false,
          'execution/setRunning'
        ),
        
        updateNodeOutput: (nodeId, nodeOutput) => set((state) => {
          if (!state.output) {
            state.output = {};
          }
          state.output[nodeId] = nodeOutput;
        }, false, 'execution/updateNodeOutput'),
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        getNodeOutput: (nodeId) => get().output?.[nodeId],
        getNodeStatus: (nodeId) => {
          const nodeOutput = get().output?.[nodeId];
          return nodeOutput?.status || null;
        },
        hasOutput: () => {
          const { output } = get();
          return output !== null && Object.keys(output).length > 0;
        },
      },
    })),
    { name: 'Execution Store' }
  )
);
