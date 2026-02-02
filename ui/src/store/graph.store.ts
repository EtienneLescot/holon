/**
 * Graph Store
 * 
 * Manages nodes and edges for the workflow graph.
 * Synchronized with backend via VSCode extension messages.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { CoreNode, CoreEdge } from '../protocol';

// ============================================================================
// Types
// ============================================================================

export interface AiStatus {
  status: 'idle' | 'working' | 'error' | 'done';
  message?: string;
}

export interface GraphStore {
  // -------------------------
  // STATE
  // -------------------------
  readonly nodes: CoreNode[];
  readonly edges: CoreEdge[];
  readonly aiStatusByNodeId: Record<string, AiStatus>;
  
  // -------------------------
  // ACTIONS
  // -------------------------
  actions: {
    // Graph sync from backend
    setGraph: (nodes: CoreNode[], edges: CoreEdge[]) => void;
    
    // Node operations
    addNode: (node: CoreNode) => void;
    updateNode: (id: string, updates: Partial<CoreNode>) => void;
    removeNode: (id: string) => void;
    updateNodePosition: (id: string, position: { x: number; y: number }) => void;
    updateNodesPositions: (positions: Array<{ id: string; position: { x: number; y: number } }>) => void;
    
    // Edge operations
    addEdge: (edge: CoreEdge) => void;
    removeEdge: (edgeId: string) => void;
    
    // AI status
    setAiStatus: (nodeId: string, status: AiStatus) => void;
    clearAiStatus: (nodeId: string) => void;
    
    // Bulk operations
    clear: () => void;
  };
  
  // -------------------------
  // SELECTORS
  // -------------------------
  selectors: {
    getNodeById: (id: string) => CoreNode | undefined;
    getEdgesByNodeId: (nodeId: string) => CoreEdge[];
    getIncomingEdges: (nodeId: string) => CoreEdge[];
    getOutgoingEdges: (nodeId: string) => CoreEdge[];
    getNodeCount: () => number;
    getEdgeCount: () => number;
    getAiStatus: (nodeId: string) => AiStatus | undefined;
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useGraphStore = create<GraphStore>()(
  devtools(
    immer((set, get) => ({
      // -------------------------
      // STATE
      // -------------------------
      nodes: [],
      edges: [],
      aiStatusByNodeId: {},
      
      // -------------------------
      // ACTIONS
      // -------------------------
      actions: {
        setGraph: (nodes, edges) => set(
          { nodes, edges },
          false,
          'graph/setGraph'
        ),
        
        addNode: (node) => set((state) => {
          state.nodes.push(node);
        }, false, 'graph/addNode'),
        
        updateNode: (id, updates) => set((state) => {
          const node = state.nodes.find(n => n.id === id);
          if (node) {
            Object.assign(node, updates);
          }
        }, false, 'graph/updateNode'),
        
        removeNode: (id) => set((state) => {
          state.nodes = state.nodes.filter(n => n.id !== id);
          state.edges = state.edges.filter(e => e.source !== id && e.target !== id);
          delete state.aiStatusByNodeId[id];
        }, false, 'graph/removeNode'),
        
        updateNodePosition: (id, position) => set((state) => {
          const node = state.nodes.find(n => n.id === id);
          if (node) {
            node.position = position;
          }
        }, false, 'graph/updateNodePosition'),
        
        updateNodesPositions: (positions) => set((state) => {
          positions.forEach(({ id, position }) => {
            const node = state.nodes.find(n => n.id === id);
            if (node) {
              node.position = position;
            }
          });
        }, false, 'graph/updateNodesPositions'),
        
        addEdge: (edge) => set((state) => {
          state.edges.push(edge);
        }, false, 'graph/addEdge'),
        
        removeEdge: (edgeId) => set((state) => {
          state.edges = state.edges.filter(e => {
            const id = `${e.kind ?? 'code'}:${e.source}:${e.sourcePort ?? ''}->${e.target}:${e.targetPort ?? ''}`;
            return id !== edgeId;
          });
        }, false, 'graph/removeEdge'),
        
        setAiStatus: (nodeId, status) => set((state) => {
          state.aiStatusByNodeId[nodeId] = status;
        }, false, 'graph/setAiStatus'),
        
        clearAiStatus: (nodeId) => set((state) => {
          delete state.aiStatusByNodeId[nodeId];
        }, false, 'graph/clearAiStatus'),
        
        clear: () => set(
          { nodes: [], edges: [], aiStatusByNodeId: {} },
          false,
          'graph/clear'
        ),
      },
      
      // -------------------------
      // SELECTORS
      // -------------------------
      selectors: {
        getNodeById: (id) => get().nodes.find(n => n.id === id),
        getEdgesByNodeId: (nodeId) => get().edges.filter(e => e.source === nodeId || e.target === nodeId),
        getIncomingEdges: (nodeId) => get().edges.filter(e => e.target === nodeId),
        getOutgoingEdges: (nodeId) => get().edges.filter(e => e.source === nodeId),
        getNodeCount: () => get().nodes.length,
        getEdgeCount: () => get().edges.length,
        getAiStatus: (nodeId) => get().aiStatusByNodeId[nodeId],
      },
    })),
    { name: 'Graph Store' }
  )
);
