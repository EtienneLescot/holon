/**
 * STORE TEMPLATE
 * 
 * All stores must follow this pattern for consistency.
 * AI agents: Copy this structure when creating new stores.
 * 
 * Steps to use:
 * 1. Copy this file
 * 2. Rename `TemplateStore`, `TemplateItem`, etc.
 * 3. Implement your state, actions, and selectors
 * 4. Export from store/index.ts
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface TemplateItem {
  id: string;
  name: string;
  // Add your properties...
}

export interface TemplateStore {
  // -------------------------
  // 1. STATE (readonly)
  // -------------------------
  readonly items: TemplateItem[];
  readonly selectedId: string | null;
  readonly isLoading: boolean;
  
  // -------------------------
  // 2. ACTIONS (grouped)
  // -------------------------
  actions: {
    // Create
    add: (item: TemplateItem) => void;
    addMany: (items: TemplateItem[]) => void;
    
    // Read/Set
    setItems: (items: TemplateItem[]) => void;
    select: (id: string | null) => void;
    
    // Update
    update: (id: string, updates: Partial<TemplateItem>) => void;
    updateMany: (updates: Array<{ id: string; updates: Partial<TemplateItem> }>) => void;
    
    // Delete
    remove: (id: string) => void;
    removeMany: (ids: string[]) => void;
    clear: () => void;
    
    // Async example
    loadItems: () => Promise<void>;
  };
  
  // -------------------------
  // 3. SELECTORS (computed)
  // -------------------------
  selectors: {
    getById: (id: string) => TemplateItem | undefined;
    getSelected: () => TemplateItem | undefined;
    getAll: () => TemplateItem[];
    getCount: () => number;
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useTemplateStore = create<TemplateStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      items: [],
      selectedId: null,
      isLoading: false,
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        add: (item) => set((state) => {
          state.items.push(item);
        }, false, 'template/add'),
        
        addMany: (items) => set((state) => {
          state.items.push(...items);
        }, false, 'template/addMany'),
        
        setItems: (items) => set((state) => {
          state.items = items;
        }, false, 'template/setItems'),
        
        select: (id) => set(
          { selectedId: id },
          false,
          'template/select'
        ),
        
        update: (id, updates) => set((state) => {
          const item = state.items.find(i => i.id === id);
          if (item) {
            Object.assign(item, updates);
          }
        }, false, 'template/update'),
        
        updateMany: (updates) => set((state) => {
          updates.forEach(({ id, updates: u }) => {
            const item = state.items.find(i => i.id === id);
            if (item) {
              Object.assign(item, u);
            }
          });
        }, false, 'template/updateMany'),
        
        remove: (id) => set((state) => {
          state.items = state.items.filter(i => i.id !== id);
        }, false, 'template/remove'),
        
        removeMany: (ids) => set((state) => {
          const idSet = new Set(ids);
          state.items = state.items.filter(i => !idSet.has(i.id));
        }, false, 'template/removeMany'),
        
        clear: () => set(
          { items: [], selectedId: null },
          false,
          'template/clear'
        ),
        
        loadItems: async () => {
          set({ isLoading: true }, false, 'template/loadItems/start');
          
          try {
            // Replace with actual API call
            const items = await new Promise<TemplateItem[]>((resolve) => {
              setTimeout(() => resolve([]), 1000);
            });
            
            set((state) => {
              state.items = items;
              state.isLoading = false;
            }, false, 'template/loadItems/success');
          } catch (error) {
            set(
              { isLoading: false },
              false,
              'template/loadItems/error'
            );
            throw error;
          }
        },
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        getById: (id) => {
          return get().items.find(i => i.id === id);
        },
        
        getSelected: () => {
          const { items, selectedId } = get();
          if (!selectedId) return undefined;
          return items.find(i => i.id === selectedId);
        },
        
        getAll: () => {
          return get().items;
        },
        
        getCount: () => {
          return get().items.length;
        },
      },
    })),
    { name: 'Template Store' }
  )
);

// ============================================================================
// Usage Examples
// ============================================================================

/*
// In components:
function MyComponent() {
  // Subscribe to specific state
  const items = useTemplateStore(s => s.items);
  const selectedId = useTemplateStore(s => s.selectedId);
  
  // Get actions (stable reference)
  const { add, update, remove } = useTemplateStore(s => s.actions);
  
  // Use selectors
  const selected = useTemplateStore(s => s.selectors.getSelected());
  
  return (
    <div>
      {items.map(item => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
}

// Outside React:
const items = useTemplateStore.getState().items;
useTemplateStore.getState().actions.add(newItem);
*/
