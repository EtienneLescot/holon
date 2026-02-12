/**
 * NodeSearchModal Component
 * 
 * Modal for searching and adding new nodes to the workflow.
 * Displays all available node types from the registry with search/filter functionality.
 */

import { useCallback, useEffect, useState, useMemo } from "react";
import { useNodeTypesStore, useUIStore, type NodeTypeDefinition } from "./store";
import { postToExtension } from "./vscodeBridge";
import type { CoreNode } from "./protocol";

interface NodeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingNodes?: CoreNode[];
}

export function NodeSearchModal({ isOpen, onClose, existingNodes = [] }: NodeSearchModalProps): JSX.Element | null {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  
  const nodeTypes = useNodeTypesStore(s => s.nodeTypes);
  const isLoading = useNodeTypesStore(s => s.isLoading);
  
  // Check if a trigger already exists
  const hasTrigger = useMemo(() => {
    return existingNodes.some(node => node.nodeType?.startsWith("trigger."));
  }, [existingNodes]);
  
  // Debug
  useEffect(() => {
    console.log("NodeSearchModal - nodeTypes:", nodeTypes);
  }, [nodeTypes]);
  
  // Compute categories directly to avoid stale closures
  const categories = useMemo(() => {
    const cats = new Set(nodeTypes.map(t => t.category));
    return Array.from(cats).sort();
  }, [nodeTypes]);
  
  // Request node types when modal opens if we don't have any
  useEffect(() => {
    if (isOpen && nodeTypes.length === 0) {
      postToExtension({ type: "ui.nodeTypes.request" });
    }
  }, [isOpen, nodeTypes.length]);
  
  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedCategory("All");
    }
  }, [isOpen]);
  
  // Filter node types
  const filteredNodeTypes = useMemo(() => {
    let filtered = nodeTypes;
    
    // Filter out triggers if one already exists
    if (hasTrigger) {
      filtered = filtered.filter(t => !t.type.startsWith("trigger."));
    }
    
    // Filter by category
    if (selectedCategory !== "All") {
      filtered = filtered.filter(t => t.category === selectedCategory);
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.label.toLowerCase().includes(lowerQuery) ||
        t.type.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery) ||
        t.category.toLowerCase().includes(lowerQuery)
      );
    }
    
    return filtered;
  }, [nodeTypes, selectedCategory, searchQuery, hasTrigger]);
  
  // Group by category
  const groupedNodeTypes = useMemo(() => {
    const groups: Record<string, NodeTypeDefinition[]> = {};
    filteredNodeTypes.forEach(type => {
      if (!groups[type.category]) {
        groups[type.category] = [];
      }
      groups[type.category]!.push(type);
    });
    return groups;
  }, [filteredNodeTypes]);
  
  const handleSelectNodeType = useCallback((nodeType: NodeTypeDefinition) => {
    // Generate a random ID for the new node
    const randomId = () => {
      const c = globalThis.crypto;
      if (c && typeof (c as any).randomUUID === "function") {
        return (c as any).randomUUID();
      }
      return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    };
    
    // Send node creation message - generates @node class with type
    postToExtension({
      type: "ui.nodeCreated",
      node: {
        id: `node:${nodeType.type.replace(/\./g, '_')}:${randomId()}`,
        type: nodeType.type,
        label: nodeType.label,
        inputs: [],
        outputs: [],
        props: nodeType.defaultProps || {},
      },
      position: { x: 100, y: 100 }, // Will be adjusted by backend/UI
    });
    
    // Close modal
    onClose();
  }, [onClose]);
  
  if (!isOpen) return null;
  
  return (
    <div className="holonModalOverlay" onClick={onClose}>
      <div 
        className="holonModal holonModalLarge holonNodeSearchModal" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="holonModalHeader">
          <h2 className="text-xl font-black uppercase italic tracking-tighter">Add Node</h2>
          <div className="text-[10px] uppercase font-black tracking-[0.2em] text-white/20 mt-2">
            {filteredNodeTypes.length} node{filteredNodeTypes.length !== 1 ? 's' : ''} available
          </div>
        </div>
        
        <div className="holonNodeSearchControls">
          {/* Search input */}
          <input
            type="text"
            className="holonNodeSearchInput"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          
          {/* Category filters */}
          <div className="holonNodeCategoryFilters">
            <button
              className={`holonCategoryButton ${selectedCategory === "All" ? "active" : ""}`}
              onClick={() => setSelectedCategory("All")}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                className={`holonCategoryButton ${selectedCategory === category ? "active" : ""}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        
        {/* Node types list */}
        <div className="holonNodeSearchResults">
          {isLoading ? (
            <div className="holonNodeSearchEmpty">
              Loading available nodes...
            </div>
          ) : filteredNodeTypes.length === 0 ? (
            <div className="holonNodeSearchEmpty">
              {searchQuery.trim() 
                ? `No nodes found matching "${searchQuery}"` 
                : nodeTypes.length === 0
                  ? "No node types available. Please check your registry."
                  : selectedCategory !== "All"
                    ? `No nodes in category "${selectedCategory}"`
                    : "No nodes available"
              }
            </div>
          ) : (
            Object.entries(groupedNodeTypes).map(([category, types]) => (
              <div key={category} className="holonNodeCategory">
                <div className="holonNodeCategoryTitle">{category}</div>
                <div className="holonNodeTypesList">
                  {types.map((nodeType) => (
                    <button
                      key={nodeType.type}
                      className="holonNodeTypeCard"
                      onClick={() => handleSelectNodeType(nodeType)}
                    >
                      <div className="holonNodeTypeLabel">{nodeType.label}</div>
                      <div className="holonNodeTypeId">{nodeType.type}</div>
                      {nodeType.description && (
                        <div className="holonNodeTypeDescription">{nodeType.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="holonModalButtons">
          <button className="holonButton" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
