/**
 * Node Types Store
 * 
 * Manages available node types from the registry.
 * Synced dynamically from the backend.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: string;
  description?: string;
  defaultProps?: Record<string, unknown>;
  icon?: string;
  connectionRole?: "flow" | "provider";
}

export interface NodeTypesStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly nodeTypes: NodeTypeDefinition[];
  readonly isLoading: boolean;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    setNodeTypes: (types: NodeTypeDefinition[]) => void;
    addNodeType: (type: NodeTypeDefinition) => void;
    setLoading: (isLoading: boolean) => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    getByType: (type: string) => NodeTypeDefinition | undefined;
    getByCategory: (category: string) => NodeTypeDefinition[];
    getCategories: () => string[];
    search: (query: string) => NodeTypeDefinition[];
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useNodeTypesStore = create<NodeTypesStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      nodeTypes: [],
      isLoading: false,
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        setNodeTypes: (types) => set(
          { nodeTypes: types, isLoading: false },
          false,
          'nodeTypes/set'
        ),
        
        addNodeType: (type) => set((state) => {
          state.nodeTypes.push(type);
        }, false, 'nodeTypes/add'),
        
        setLoading: (isLoading) => set(
          { isLoading },
          false,
          'nodeTypes/setLoading'
        ),
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        getByType: (type) => get().nodeTypes.find(t => t.type === type),
        getByCategory: (category) => get().nodeTypes.filter(t => t.category === category),
        getCategories: () => {
          const categories = new Set(get().nodeTypes.map(t => t.category));
          return Array.from(categories).sort();
        },
        search: (query) => {
          const lowerQuery = query.toLowerCase();
          return get().nodeTypes.filter(t => 
            t.label.toLowerCase().includes(lowerQuery) ||
            t.type.toLowerCase().includes(lowerQuery) ||
            t.description?.toLowerCase().includes(lowerQuery) ||
            t.category.toLowerCase().includes(lowerQuery)
          );
        },
      },
    })),
    { name: 'Node Types Store' }
  )
);
