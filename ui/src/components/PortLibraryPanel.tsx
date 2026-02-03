/**
 * Port Library Panel
 * 
 * Displays all available ports in the workflow for manual mapping.
 * Allows filtering, searching, and drag & drop to create port connections.
 */

import { useState, useMemo, useEffect } from 'react';
import { useGraphStore, useMappingStore, type PortInfo, type NodeWithPorts } from '../store';
import { inferPorts } from '../ports';
import { MappingEditorModal } from './MappingEditorModal';
import { postToExtension } from '../vscodeBridge';

interface PortLibraryPanelProps {
  onClose: () => void;
}

export function PortLibraryPanel({ onClose }: PortLibraryPanelProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const mappings = useMappingStore((s) => s.mappings);
  const { selectSourcePort, selectTargetPort, selectedSourcePort, selectedTargetPort, clearSelection } = useMappingStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [portKindFilter, setPortKindFilter] = useState<'all' | 'data' | 'llm' | 'memory' | 'control'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'input' | 'output'>('all');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorSource, setEditorSource] = useState<{ nodeId: string; port: PortInfo } | null>(null);
  const [editorTarget, setEditorTarget] = useState<{ nodeId: string; port: PortInfo } | null>(null);

  // Convert nodes to NodeWithPorts first (needed by useEffect)
  const nodesWithPorts: NodeWithPorts[] = useMemo(() => {
    return nodes.map((node) => {
      // node.ports is an array of PortSpec from protocol
      const portsList = node.ports && node.ports.length > 0
        ? node.ports.map(p => ({
            id: p.id,
            direction: p.direction,
            kind: (p.kind as PortInfo['kind']) || undefined,
            label: p.label || undefined,
            schema: undefined,
            connected: false,
            compatibleWith: undefined,
          } as PortInfo))
        : inferPorts({ kind: node.kind, nodeType: node.nodeType || undefined }).map(p => ({
            ...p,
            schema: undefined,
            connected: false,
            compatibleWith: undefined,
          } as PortInfo));

      const inputs = portsList.filter(p => p.direction === 'input');
      const outputs = portsList.filter(p => p.direction === 'output');

      return {
        id: node.id,
        label: node.label || node.name,
        type: node.nodeType || '',
        ports: { inputs, outputs },
      };
    });
  }, [nodes]);

  // Auto-open editor when both source and target are selected
  useEffect(() => {
    if (selectedSourcePort && selectedTargetPort) {
      // Find the port info for both
      const sourceNode = nodesWithPorts.find(n => n.id === selectedSourcePort.nodeId);
      const targetNode = nodesWithPorts.find(n => n.id === selectedTargetPort.nodeId);
      
      const sourcePort = sourceNode?.ports.outputs.find(p => p.id === selectedSourcePort.port);
      const targetPort = targetNode?.ports.inputs.find(p => p.id === selectedTargetPort.port);
      
      if (sourcePort && targetPort) {
        setEditorSource({ nodeId: selectedSourcePort.nodeId, port: sourcePort });
        setEditorTarget({ nodeId: selectedTargetPort.nodeId, port: targetPort });
        setIsEditorOpen(true);
        clearSelection();
      }
    }
  }, [selectedSourcePort, selectedTargetPort, clearSelection, nodesWithPorts]);

  // Filter nodes based on search and filters
  const filteredNodes = useMemo(() => {
    return nodesWithPorts.filter((node) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesNode = node.label.toLowerCase().includes(query) || 
                           node.id.toLowerCase().includes(query);
        const matchesPorts = [...node.ports.inputs, ...node.ports.outputs].some(
          p => p.id.toLowerCase().includes(query) || p.label?.toLowerCase().includes(query)
        );
        if (!matchesNode && !matchesPorts) return false;
      }

      // Port kind filter
      if (portKindFilter !== 'all') {
        const hasPorts = [...node.ports.inputs, ...node.ports.outputs].some(
          p => p.kind === portKindFilter
        );
        if (!hasPorts) return false;
      }

      // Direction filter
      if (directionFilter === 'input' && node.ports.inputs.length === 0) return false;
      if (directionFilter === 'output' && node.ports.outputs.length === 0) return false;

      return true;
    });
  }, [nodesWithPorts, searchQuery, portKindFilter, directionFilter]);

  const handlePortClick = (nodeId: string, port: PortInfo) => {
    if (port.direction === 'output') {
      selectSourcePort(nodeId, port.id);
    } else {
      selectTargetPort(nodeId, port.id);
    }
  };

  const isPortSelected = (nodeId: string, portId: string, direction: 'input' | 'output') => {
    if (direction === 'output') {
      return selectedSourcePort?.nodeId === nodeId && selectedSourcePort?.port === portId;
    } else {
      return selectedTargetPort?.nodeId === nodeId && selectedTargetPort?.port === portId;
    }
  };

  const handleMappingSave = (mappingConfig: any) => {
    // Send RPC to extension to generate and insert @port_map code
    postToExtension({
      type: 'ui.mapping.insertCode',
      payload: {
        source: editorSource,
        target: editorTarget,
        config: mappingConfig
      }
    });
    setIsEditorOpen(false);
    setEditorSource(null);
    setEditorTarget(null);
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditorSource(null);
    setEditorTarget(null);
  };

  return (
    <>
      {isEditorOpen && editorSource && editorTarget && (
        <MappingEditorModal
          source={editorSource}
          target={editorTarget}
          onSave={handleMappingSave}
          onClose={handleEditorClose}
        />
      )}
      
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔌</span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Port Library
          </h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ✕
        </button>
      </div>

      {/* Search & Filters */}
      <div className="p-4 space-y-3 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          placeholder="🔍 Search ports..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        />
        
        <div className="flex gap-2">
          <select
            value={portKindFilter}
            onChange={(e) => setPortKindFilter(e.target.value as any)}
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All Kinds</option>
            <option value="data">Data</option>
            <option value="llm">LLM</option>
            <option value="memory">Memory</option>
            <option value="control">Control</option>
          </select>

          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as any)}
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All Directions</option>
            <option value="input">Inputs Only</option>
            <option value="output">Outputs Only</option>
          </select>
        </div>
      </div>

      {/* Nodes List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {filteredNodes.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            No ports found
          </div>
        ) : (
          filteredNodes.map((node) => (
            <div
              key={node.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-750"
            >
              {/* Node Header */}
              <div className="font-medium text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                <span>📦</span>
                <span className="truncate">{node.label}</span>
              </div>
              {node.type && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {node.type}
                </div>
              )}

              {/* Inputs */}
              {node.ports.inputs.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Inputs:
                  </div>
                  <div className="space-y-1">
                    {node.ports.inputs.map((port) => (
                      <button
                        key={port.id}
                        onClick={() => handlePortClick(node.id, port)}
                        className={`
                          w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2
                          ${isPortSelected(node.id, port.id, 'input')
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500'
                            : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                          }
                        `}
                      >
                        <span className="text-xs">📥</span>
                        <span className="flex-1 truncate">
                          {port.label || port.id}
                        </span>
                        {port.kind && (
                          <span className="text-xs px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                            {port.kind}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Outputs */}
              {node.ports.outputs.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Outputs:
                  </div>
                  <div className="space-y-1">
                    {node.ports.outputs.map((port) => (
                      <button
                        key={port.id}
                        onClick={() => handlePortClick(node.id, port)}
                        className={`
                          w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2
                          ${isPortSelected(node.id, port.id, 'output')
                            ? 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100 ring-2 ring-green-500'
                            : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                          }
                        `}
                      >
                        <span className="text-xs">📤</span>
                        <span className="flex-1 truncate">
                          {port.label || port.id}
                        </span>
                        {port.kind && (
                          <span className="text-xs px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                            {port.kind}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer with selection status */}
      {(selectedSourcePort || selectedTargetPort) && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {selectedSourcePort && (
              <div className="mb-1">
                ✅ Source: <strong>{selectedSourcePort.nodeId}</strong>.{selectedSourcePort.port}
              </div>
            )}
            {selectedTargetPort && (
              <div>
                ✅ Target: <strong>{selectedTargetPort.nodeId}</strong>.{selectedTargetPort.port}
              </div>
            )}
            {selectedSourcePort && selectedTargetPort && (
              <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                Click any port to open the mapping editor
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        💡 Click an output port, then an input port to create a mapping
      </div>
    </div>
    </>
  );
}
