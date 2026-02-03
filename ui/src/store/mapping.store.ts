/**
 * Port Mapping Store
 * 
 * Manages port mappings state and operations for the UI.
 * Provides functionality for creating, editing, and deleting port mappings.
 */

import { create } from 'zustand';

export interface PortMapping {
  id: string;
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
  transform?: string;
  targetField?: string;
  when?: string;
  onError: 'stop' | 'skip' | 'pass';
}

export interface PortInfo {
  id: string;
  direction: 'input' | 'output';
  kind?: 'data' | 'llm' | 'memory' | 'tool' | 'parser' | 'control';
  label?: string;
  schema?: string | undefined;
  connected: boolean;
  compatibleWith?: string[] | undefined;
}

export interface NodeWithPorts {
  id: string;
  label: string;
  type: string;
  ports: {
    inputs: PortInfo[];
    outputs: PortInfo[];
  };
}

export interface MappingEditorState {
  isOpen: boolean;
  source?: { nodeId: string; port: PortInfo };
  target?: { nodeId: string; port: PortInfo };
  existingMapping?: PortMapping | undefined;
}

export interface MappingStore {
  // State
  mappings: PortMapping[];
  isLibraryOpen: boolean;
  editorState: MappingEditorState;
  selectedSourcePort: { nodeId: string; port: string } | null;
  selectedTargetPort: { nodeId: string; port: string } | null;
  
  // Library actions
  openLibrary: () => void;
  closeLibrary: () => void;
  toggleLibrary: () => void;
  
  // Port selection
  selectSourcePort: (nodeId: string, port: string) => void;
  selectTargetPort: (nodeId: string, port: string) => void;
  clearSelection: () => void;
  
  // Editor actions
  openEditor: (
    source: { nodeId: string; port: PortInfo },
    target: { nodeId: string; port: PortInfo },
    existingMapping?: PortMapping
  ) => void;
  closeEditor: () => void;
  
  // Mapping CRUD
  addMapping: (mapping: Omit<PortMapping, 'id'>) => void;
  updateMapping: (id: string, updates: Partial<PortMapping>) => void;
  deleteMapping: (id: string) => void;
  setMappings: (mappings: PortMapping[]) => void;
  
  // Queries
  getMappingForPort: (targetNode: string, targetPort: string) => PortMapping | undefined;
  getMappingsForNode: (nodeId: string) => PortMapping[];
  getMappingForEdge: (sourceNode: string, targetNode: string) => PortMapping | undefined;
}

export const useMappingStore = create<MappingStore>((set, get) => ({
  // Initial state
  mappings: [],
  isLibraryOpen: false,
  editorState: { isOpen: false },
  selectedSourcePort: null,
  selectedTargetPort: null,
  
  // Library actions
  openLibrary: () => set({ isLibraryOpen: true }),
  closeLibrary: () => set({ isLibraryOpen: false }),
  toggleLibrary: () => set((state) => ({ isLibraryOpen: !state.isLibraryOpen })),
  
  // Port selection
  selectSourcePort: (nodeId: string, port: string) => {
    set({ selectedSourcePort: { nodeId, port } });
    
    // If we already have a target, open the editor
    const target = get().selectedTargetPort;
    if (target) {
      // TODO: Open editor with source and target
      get().clearSelection();
    }
  },
  
  selectTargetPort: (nodeId: string, port: string) => {
    set({ selectedTargetPort: { nodeId, port } });
    
    // If we already have a source, open the editor
    const source = get().selectedSourcePort;
    if (source) {
      // TODO: Open editor with source and target
      get().clearSelection();
    }
  },
  
  clearSelection: () => {
    set({ selectedSourcePort: null, selectedTargetPort: null });
  },
  
  // Editor actions
  openEditor: (source, target, existingMapping) => {
    set({
      editorState: {
        isOpen: true,
        source,
        target,
        existingMapping,
      },
    });
  },
  
  closeEditor: () => {
    set({
      editorState: { isOpen: false },
    });
  },
  
  // Mapping CRUD
  addMapping: (mapping) => {
    const id = `mapping-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    set((state) => ({
      mappings: [...state.mappings, { ...mapping, id }],
    }));
  },
  
  updateMapping: (id, updates) => {
    set((state) => ({
      mappings: state.mappings.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
  },
  
  deleteMapping: (id) => {
    set((state) => ({
      mappings: state.mappings.filter((m) => m.id !== id),
    }));
  },
  
  setMappings: (mappings) => {
    set({ mappings });
  },
  
  // Queries
  getMappingForPort: (targetNode, targetPort) => {
    return get().mappings.find(
      (m) => m.targetNode === targetNode && m.targetPort === targetPort
    );
  },
  
  getMappingsForNode: (nodeId) => {
    return get().mappings.filter(
      (m) => m.sourceNode === nodeId || m.targetNode === nodeId
    );
  },
  
  getMappingForEdge: (sourceNode, targetNode) => {
    return get().mappings.find(
      (m) => m.sourceNode === sourceNode && m.targetNode === targetNode
    );
  },
}));
