/**
 * Edge Inspector Component
 * 
 * Displays port mapping details when hovering/clicking on an edge.
 * Shows transformation type, expression, target field, and provides
 * edit/delete actions for the mapping.
 */

import { useMappingStore, type PortMapping } from '../store';
import { postToExtension } from '../vscodeBridge';

interface EdgeInspectorProps {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: string;
  targetPort: string;
  position: { x: number; y: number };
  onClose: () => void;
  onEdit?: () => void;
}

export function EdgeInspector({
  edgeId,
  sourceNodeId,
  targetNodeId,
  sourcePort,
  targetPort,
  position,
  onClose,
  onEdit,
}: EdgeInspectorProps) {
  const mappings = useMappingStore((s) => s.mappings);

  // Find mapping for this edge
  const mapping = mappings.find(
    (m) =>
      m.sourceNode === sourceNodeId &&
      m.sourcePort === sourcePort &&
      m.targetNode === targetNodeId &&
      m.targetPort === targetPort
  );

  const handleViewCode = () => {
    // Send RPC to scroll to @port_map in editor
    if (mapping) {
      postToExtension({
        type: 'ui.mapping.viewCode',
        payload: {
          mappingId: mapping.id,
        },
      });
    }
  };

  const handleDelete = () => {
    if (mapping && confirm('Delete this port mapping?')) {
      postToExtension({
        type: 'ui.mapping.delete',
        payload: {
          mappingId: mapping.id,
        },
      });
      onClose();
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit();
    }
  };

  const getTransformIcon = (transform?: string) => {
    if (!transform) return '⚡';
    if (transform.startsWith('$.')) return '🔍';
    if (transform.includes('{') && transform.includes('}')) return '📝';
    if (transform.startsWith('lambda')) return '🔧';
    return '🔀';
  };

  const getTransformLabel = (transform?: string) => {
    if (!transform) return 'Direct pass-through';
    if (transform.startsWith('$.')) return 'JSONPath extraction';
    if (transform.includes('{') && transform.includes('}')) return 'Template string';
    if (transform.startsWith('lambda')) return 'Python lambda';
    return 'Transform';
  };

  if (!mapping) {
    return (
      <div
        className="absolute bg-gray-900 text-white text-sm px-3 py-2 rounded shadow-lg border border-gray-700 z-[100]"
        style={{ left: position.x, top: position.y }}
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">No mapping configured</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xs"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 z-[100] min-w-[320px] max-w-[480px]"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xl">{getTransformIcon(mapping.transform)}</span>
          <h3 className="font-semibold text-sm">Port Mapping</h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3 text-sm">
        {/* Connection info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
              {sourcePort}
            </span>
            <span>→</span>
            <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
              {targetPort}
            </span>
          </div>
        </div>

        {/* Transform details */}
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
              Transform Type
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg">{getTransformIcon(mapping.transform)}</span>
              <span className="text-sm">{getTransformLabel(mapping.transform)}</span>
            </div>
          </div>

          {mapping.transform && (
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                Expression
              </label>
              <pre className="bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded text-xs font-mono overflow-x-auto">
                {mapping.transform}
              </pre>
            </div>
          )}

          {mapping.targetField && (
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                Target Field
              </label>
              <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                {mapping.targetField}
              </code>
            </div>
          )}

          {mapping.when && (
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                Condition
              </label>
              <code className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded text-xs">
                {mapping.when}
              </code>
            </div>
          )}

          {mapping.onError && mapping.onError !== 'pass' && (
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                Error Handling
              </label>
              <span className="inline-flex items-center gap-1 bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 px-2 py-1 rounded text-xs">
                <span>⚠️</span>
                <span>{mapping.onError}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-lg">
        <button
          onClick={handleViewCode}
          className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-medium"
        >
          📄 View Code
        </button>
        <button
          onClick={handleEdit}
          className="flex-1 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
        >
          ✏️ Edit
        </button>
        <button
          onClick={handleDelete}
          className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition text-sm font-medium"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
