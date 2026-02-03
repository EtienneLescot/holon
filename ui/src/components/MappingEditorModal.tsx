/**
 * Mapping Editor Modal
 * 
 * Allows users to configure port mappings with transformations.
 * Supports JSONPath, templates, and Python lambda expressions.
 */

import { useState, useMemo } from 'react';
import { useMappingStore, type PortInfo } from '../store';

interface MappingEditorModalProps {
  source: { nodeId: string; port: PortInfo };
  target: { nodeId: string; port: PortInfo };
  existingMapping?: {
    id: string;
    transform?: string;
    targetField?: string;
    when?: string;
    onError: 'stop' | 'skip' | 'pass';
  };
  onClose: () => void;
  onSave: (config: {
    transform?: string;
    targetField?: string;
    when?: string;
    onError: 'stop' | 'skip' | 'pass';
  }) => void;
}

type TransformType = 'identity' | 'jsonpath' | 'template' | 'lambda';

const JSONPATH_EXAMPLES = [
  { label: 'Content', value: '$.content' },
  { label: 'Metadata Role', value: '$.metadata.role' },
  { label: 'Metadata Conversation ID', value: '$.metadata.conversationId' },
  { label: 'Origin Node ID', value: '$.origin.nodeId' },
  { label: 'Timestamp', value: '$.timestamp' },
];

const TEMPLATE_EXAMPLES = [
  { label: 'Prefixed', value: 'User: {{content}}' },
  { label: 'Role + Content', value: '{{metadata.role}}: {{content}}' },
  { label: 'Full Format', value: '[{{metadata.conversationId}}] {{metadata.role}}: {{content}}' },
  { label: 'Markdown Bold', value: '**{{metadata.role}}**: {{content}}' },
];

const LAMBDA_EXAMPLES = [
  { label: 'Uppercase', value: 'lambda env: env.content.upper()' },
  { label: 'Lowercase', value: 'lambda env: env.content.lower()' },
  { label: 'Length', value: 'lambda env: len(env.content)' },
  { label: 'Extract Role', value: "lambda env: env.metadata['role']" },
  { label: 'DataEnvelope', value: "lambda env: DataEnvelope(type='message', content=env.content, metadata={'role': 'assistant'})" },
];

export function MappingEditorModal({
  source,
  target,
  existingMapping,
  onClose,
  onSave,
}: MappingEditorModalProps) {
  const [transformType, setTransformType] = useState<TransformType>(() => {
    if (!existingMapping?.transform) return 'identity';
    if (existingMapping.transform.startsWith('$.')) return 'jsonpath';
    if (existingMapping.transform.includes('{{')) return 'template';
    if (existingMapping.transform.startsWith('lambda')) return 'lambda';
    return 'identity';
  });

  const [transform, setTransform] = useState(existingMapping?.transform || '');
  const [targetField, setTargetField] = useState(existingMapping?.targetField || '');
  const [when, setWhen] = useState(existingMapping?.when || '');
  const [onError, setOnError] = useState<'stop' | 'skip' | 'pass'>(existingMapping?.onError || 'stop');

  const previewCode = useMemo(() => {
    const lines = [
      '@port_map',
      'class _:',
      `    source = (${source.nodeId.split(':')[1] || source.nodeId}, "${source.port.id}")`,
      `    target = (${target.nodeId.split(':')[1] || target.nodeId}, "${target.port.id}")`,
    ];

    if (transformType !== 'identity' && transform) {
      lines.push(`    transform = "${transform}"`);
    }

    if (targetField) {
      lines.push(`    target_field = "${targetField}"`);
    }

    if (when) {
      lines.push(`    when = "${when}"`);
    }

    if (onError !== 'stop') {
      lines.push(`    on_error = "${onError}"`);
    }

    return lines.join('\n');
  }, [source, target, transformType, transform, targetField, when, onError]);

  const handleSave = () => {
    const config: {
      transform?: string;
      targetField?: string;
      when?: string;
      onError: 'stop' | 'skip' | 'pass';
    } = {
      onError,
    };
    
    if (transformType !== 'identity' && transform) {
      config.transform = transform;
    }
    if (targetField) {
      config.targetField = targetField;
    }
    if (when) {
      config.when = when;
    }
    
    onSave(config);
    onClose();
  };

  const handleExampleClick = (value: string) => {
    setTransform(value);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Port Mapping Editor
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {source.nodeId}.{source.port.id} → {target.nodeId}.{target.port.id}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Source Schema */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Source Port
            </h3>
            <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 text-sm font-mono">
              <div className="text-gray-600 dark:text-gray-400">
                {source.nodeId} / {source.port.label || source.port.id}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                Kind: {source.port.kind || 'unknown'} | Direction: {source.port.direction}
              </div>
            </div>
          </div>

          {/* Target Schema */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Target Port
            </h3>
            <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 text-sm font-mono">
              <div className="text-gray-600 dark:text-gray-400">
                {target.nodeId} / {target.port.label || target.port.id}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                Kind: {target.port.kind || 'unknown'} | Direction: {target.port.direction}
              </div>
            </div>
          </div>

          {/* Transformation Type */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Transformation
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={transformType === 'identity'}
                  onChange={() => setTransformType('identity')}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Identity (pass through)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={transformType === 'jsonpath'}
                  onChange={() => setTransformType('jsonpath')}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Extract field (JSONPath)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={transformType === 'template'}
                  onChange={() => setTransformType('template')}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Template (Mustache)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={transformType === 'lambda'}
                  onChange={() => setTransformType('lambda')}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Custom (Python Lambda)
                </span>
              </label>
            </div>
          </div>

          {/* Transform Input */}
          {transformType !== 'identity' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Transform Expression
              </label>
              <input
                type="text"
                value={transform}
                onChange={(e) => setTransform(e.target.value)}
                placeholder={
                  transformType === 'jsonpath'
                    ? '$.content'
                    : transformType === 'template'
                    ? '{{metadata.role}}: {{content}}'
                    : 'lambda env: env.content'
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />

              {/* Examples */}
              <div className="mt-2">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Examples:</div>
                <div className="flex flex-wrap gap-2">
                  {transformType === 'jsonpath' &&
                    JSONPATH_EXAMPLES.map((ex) => (
                      <button
                        key={ex.value}
                        onClick={() => handleExampleClick(ex.value)}
                        className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                      >
                        {ex.label}
                      </button>
                    ))}
                  {transformType === 'template' &&
                    TEMPLATE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.value}
                        onClick={() => handleExampleClick(ex.value)}
                        className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                      >
                        {ex.label}
                      </button>
                    ))}
                  {transformType === 'lambda' &&
                    LAMBDA_EXAMPLES.map((ex) => (
                      <button
                        key={ex.value}
                        onClick={() => handleExampleClick(ex.value)}
                        className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                      >
                        {ex.label}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* Target Field */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Target Field (optional)
            </label>
            <input
              type="text"
              value={targetField}
              onChange={(e) => setTargetField(e.target.value)}
              placeholder="user"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Inject transformed value into a specific field (e.g., "user" for prompt.user)
            </p>
          </div>

          {/* Advanced Options */}
          <details className="border border-gray-200 dark:border-gray-700 rounded p-3">
            <summary className="text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer">
              Advanced Options
            </summary>
            <div className="mt-3 space-y-3">
              {/* Conditional (when) */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Conditional (when)
                </label>
                <input
                  type="text"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  placeholder='$.metadata.role == "user"'
                  className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-mono"
                />
              </div>

              {/* On Error */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  On Error
                </label>
                <select
                  value={onError}
                  onChange={(e) => setOnError(e.target.value as any)}
                  className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                >
                  <option value="stop">Stop (halt execution)</option>
                  <option value="skip">Skip (continue without this input)</option>
                  <option value="pass">Pass (use original value)</option>
                </select>
              </div>
            </div>
          </details>

          {/* Code Preview */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Preview Generated Code
            </h3>
            <pre className="bg-gray-900 text-gray-100 rounded p-4 text-sm font-mono overflow-x-auto">
              {previewCode}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              💾 Insert Code
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              🤖 Apply via AI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
