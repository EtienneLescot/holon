"""Spec node resolver with port discovery."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

from holon.registry import resolve_spec_node, has_spec_type


@dataclass
class ResolvedNode:
    """A resolved spec node with its runtime object."""
    
    node_id: str
    node_type: str
    props: dict[str, Any]
    runtime_object: Any
    
    def __repr__(self) -> str:
        return f"ResolvedNode({self.node_id}, type={self.node_type})"


class SpecResolver:
    """Resolves spec nodes to runtime objects."""
    
    def __init__(self) -> None:
        self._cache: dict[str, ResolvedNode] = {}
    
    def resolve(self, node_id: str, node_type: str, props: dict[str, Any]) -> ResolvedNode:
        """Resolve a spec node to its runtime object.
        
        Args:
            node_id: Unique node identifier
            node_type: Spec type (e.g., "llm.openai", "langchain.agent")
            props: Configuration properties
        
        Returns:
            ResolvedNode with runtime object
        
        Raises:
            ValueError: If no resolver registered for type
        """
        # Check cache
        if node_id in self._cache:
            sys.stderr.write(f"[RESOLVER] Cache hit: {node_id}\n")
            sys.stderr.flush()
            return self._cache[node_id]
        
        sys.stderr.write(f"[RESOLVER] Resolving {node_id} (type={node_type})\n")
        sys.stderr.write(f"[RESOLVER] Props: {props}\n")
        sys.stderr.flush()
        
        # Check if resolver exists
        if not has_spec_type(node_type):
            sys.stderr.write(f"[RESOLVER] WARNING: No resolver for type '{node_type}', using props object\n")
            sys.stderr.flush()
            # Create a simple namespace object with the props
            from types import SimpleNamespace
            runtime_object = SimpleNamespace(**props)
        else:
            # Resolve using registry
            runtime_object = resolve_spec_node(node_type, props)
        
        resolved = ResolvedNode(
            node_id=node_id,
            node_type=node_type,
            props=props,
            runtime_object=runtime_object,
        )
        
        self._cache[node_id] = resolved
        sys.stderr.write(f"[RESOLVER] Resolved {node_id} → {type(runtime_object).__name__}\n")
        sys.stderr.flush()
        
        return resolved
    
    def get_cached(self, node_id: str) -> ResolvedNode | None:
        """Get a cached resolved node."""
        return self._cache.get(node_id)
