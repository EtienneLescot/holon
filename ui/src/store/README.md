# Store Architecture

All stores MUST follow the template in `template.ts` to ensure consistency across the codebase, especially for AI agents.

## Structure

```
store/
├── README.md              # This file
├── template.ts            # Template to copy for new stores
├── index.ts               # Central exports
├── graph.store.ts         # Nodes and edges state
├── ui.store.ts            # UI state (modals, selections)
├── execution.store.ts     # Workflow execution results
└── credentials.store.ts   # API credentials
```

## Creating a New Store (AI Agents: Follow This)

1. **Copy `template.ts`** as starting point
2. **Rename** interfaces and types
3. **Implement** state, actions, selectors following the pattern
4. **Export** from `index.ts`

## Store Pattern Rules

### 1. State (readonly)
```typescript
readonly items: Item[];
readonly selectedId: string | null;
```

### 2. Actions (grouped, verb-based naming)
```typescript
actions: {
  add: (item: Item) => void;
  update: (id: string, updates: Partial<Item>) => void;
  remove: (id: string) => void;
}
```

### 3. Selectors (computed, prefixed with get)
```typescript
selectors: {
  getById: (id: string) => Item | undefined;
  getSelected: () => Item | undefined;
}
```

### 4. Middleware Stack
```typescript
create<Store>()(
  devtools(
    immer((set, get) => ({ ... })),
    { name: 'Store Name' }
  )
)
```

### 5. DevTools Actions
```typescript
set((state) => {
  state.items.push(item);
}, false, 'items/add')  // Format: 'domain/action'
```

## Usage Examples

```typescript
// Subscribe to state
const items = useGraphStore(s => s.nodes);
const selectedId = useUIStore(s => s.selectedNodeId);

// Use actions
const { add, update } = useGraphStore(s => s.actions);
add(newNode);

// Use selectors
const selected = useGraphStore(s => s.selectors.getSelectedNode());

// Get state outside React
const currentNodes = useGraphStore.getState().nodes;
useGraphStore.getState().actions.add(node);
```

## Best Practices

1. **One domain = One store** - Don't mix concerns
2. **Selectors for derived data** - Never compute in components
3. **Actions for all mutations** - Never mutate state directly in components
4. **Use immer middleware** - Allows draft-style mutations
5. **Name DevTools actions** - Makes debugging easier
6. **Type everything** - Full TypeScript coverage

## Performance Tips

1. **Selective subscriptions** - Only subscribe to what you need
   ```typescript
   // ✅ Good - only re-renders when nodes change
   const nodes = useGraphStore(s => s.nodes);
   
   // ❌ Bad - re-renders on any store change
   const store = useGraphStore();
   const nodes = store.nodes;
   ```

2. **Stable actions** - Actions don't cause re-renders
   ```typescript
   const { add } = useGraphStore(s => s.actions); // Never changes
   ```

3. **Computed selectors** - For expensive operations
   ```typescript
   selectors: {
     getFilteredNodes: () => {
       const { nodes, filter } = get();
       return nodes.filter(n => n.name.includes(filter));
     }
   }
   ```
