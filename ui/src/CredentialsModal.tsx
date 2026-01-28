import React, { useState, useEffect } from "react";

interface CredentialsModalProps {
  provider: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (provider: string, creds: Record<string, string>) => void;
  initialCreds?: Record<string, string> | undefined;
}

export function CredentialsModal({ provider, isOpen, onClose, onSave, initialCreds }: CredentialsModalProps) {
  const [creds, setCreds] = useState<Record<string, string>>(initialCreds || { api_key: "" });

  useEffect(() => {
    if (initialCreds) {
      setCreds(initialCreds);
    }
  }, [initialCreds]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(provider, creds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-gray-900 p-6 shadow-xl border border-gray-700">
        <h2 className="mb-4 text-xl font-bold text-white uppercase tracking-wider">
          Configure {provider}
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">
              API Key
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={creds.api_key || ""}
              onChange={(e) => setCreds({ ...creds, api_key: e.target.value })}
              placeholder="sk-..."
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors shadow-lg"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
