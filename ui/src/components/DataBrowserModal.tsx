/**
 * Data Browser Modal
 * 
 * Displays available data from upstream nodes that can be referenced
 * in the current node's properties using {{node.field}} syntax.
 * 
 * Different from port mappings (@port_map) which define execution order.
 * This is for injecting data references into text fields at authoring time.
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store';

interface DataField {
  path: string; // Full path like "chat_output.data.message"
  type?: string | undefined; // Inferred type if available
  description?: string | undefined;
}

interface UpstreamNodeData {
  nodeId: string;
  label: string;
  fields: DataField[];
}

interface DataBrowserModalProps {
  targetNodeId: string;
  onSelect: (reference: string) => void;
  onClose: () => void;
}

export function DataBrowserModal({ targetNodeId, onSelect, onClose }: DataBrowserModalProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate upstream nodes (nodes that connect TO the target node)
  const upstreamNodes = useMemo(() => {
    const upstream: UpstreamNodeData[] = [];

    // Find all edges that have target as the target node
    const incomingEdges = edges.filter((edge) => edge.target === targetNodeId);
    
    // Get unique source node IDs
    const sourceNodeIds = new Set(incomingEdges.map((edge) => edge.source));

    // For each upstream node, extract available fields
    sourceNodeIds.forEach((nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const fields: DataField[] = [];

      // Strategy 1: Extract from output ports schema (if available)
      const outputPorts = node.ports?.filter((p) => p.direction === 'output') || [];
      outputPorts.forEach((port) => {
        // For now, just add the port as a top-level field
        // TODO: Parse schema to extract nested fields
        fields.push({
          path: `${nodeId}.${port.id}`,
          type: port.kind || undefined,
          description: port.label || undefined,
        });
      });

      // Strategy 2: If node has structured_output in props, parse it
      if (node.props?.structured_output) {
        try {
          const schema = JSON.parse(node.props.structured_output as string);
          // Extract fields from Pydantic schema
          if (schema.properties) {
            Object.keys(schema.properties).forEach((key) => {
              const prop = schema.properties[key];
              fields.push({
                path: `${nodeId}.${key}`,
                type: prop.type || undefined,
                description: prop.description || undefined,
              });
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Strategy 3: Default fallback - assume common output structure
      if (fields.length === 0) {
        // Add some common fields based on node type
        if (node.nodeType?.includes('agent') || node.nodeType?.includes('chat')) {
          fields.push(
            { path: `${nodeId}.content`, type: 'string', description: 'Message content' },
            { path: `${nodeId}.data`, type: 'object', description: 'Full output data' }
          );
        } else if (node.nodeType?.includes('llm')) {
          fields.push(
            { path: `${nodeId}.text`, type: 'string', description: 'Generated text' },
            { path: `${nodeId}.response`, type: 'string', description: 'LLM response' }
          );
        } else {
          // Generic fallback
          fields.push(
            { path: `${nodeId}.output`, type: 'any', description: 'Node output' },
            { path: `${nodeId}.result`, type: 'any', description: 'Node result' }
          );
        }
      }

      upstream.push({
        nodeId,
        label: node.label || node.name,
        fields,
      });
    });

    return upstream;
  }, [nodes, edges, targetNodeId]);

  // Filter fields based on search
  const filteredData = useMemo(() => {
    if (!searchQuery) return upstreamNodes;

    const query = searchQuery.toLowerCase();
    return upstreamNodes
      .map((nodeData) => ({
        ...nodeData,
        fields: nodeData.fields.filter(
          (f) =>
            f.path.toLowerCase().includes(query) ||
            f.description?.toLowerCase().includes(query)
        ),
      }))
      .filter((nodeData) => nodeData.fields.length > 0);
  }, [upstreamNodes, searchQuery]);

  const handleFieldClick = (path: string) => {
    onSelect(`{{${path}}}`);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              📊 Available Data
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Select data from upstream nodes to reference
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            placeholder="🔍 Search fields..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            autoFocus
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredData.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              {upstreamNodes.length === 0 ? (
                <>
                  <div className="text-4xl mb-3">🔌</div>
                  <p>No upstream nodes connected</p>
                  <p className="text-sm mt-2">Connect nodes to see available data</p>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-3">🔍</div>
                  <p>No fields match your search</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {filteredData.map((nodeData) => (
                <div key={nodeData.nodeId} className="space-y-2">
                  {/* Node header */}
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                      {nodeData.label}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ({nodeData.fields.length} {nodeData.fields.length === 1 ? 'field' : 'fields'})
                    </span>
                  </div>

                  {/* Fields list */}
                  <div className="space-y-1">
                    {nodeData.fields.map((field) => (
                      <button
                        key={field.path}
                        onClick={() => handleFieldClick(field.path)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition text-left group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-purple-600 dark:text-purple-400 truncate">
                              {field.path}
                            </code>
                            {field.type && (
                              <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded">
                                {field.type}
                              </span>
                            )}
                          </div>
                          {field.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                              {field.description}
                            </div>
                          )}
                        </div>
                        <div className="ml-3 opacity-0 group-hover:opacity-100 transition">
                          <span className="text-xs px-2 py-1 bg-blue-600 text-white rounded">
                            Insert
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            💡 <strong>Tip:</strong> Click a field to insert <code className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">{'{{node.field}}'}</code> reference
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
