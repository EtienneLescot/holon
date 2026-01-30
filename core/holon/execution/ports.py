"""Port management and data flow."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PortValue:
    """A value flowing through a port."""
    
    node_id: str
    port_id: str
    value: Any
    
    def __repr__(self) -> str:
        value_repr = repr(self.value)
        if len(value_repr) > 50:
            value_repr = value_repr[:47] + "..."
        return f"PortValue({self.node_id}.{self.port_id}={value_repr})"


@dataclass
class PortConnection:
    """A connection between two ports."""
    
    source_node: str
    source_port: str
    target_node: str
    target_port: str
    
    def __repr__(self) -> str:
        return f"{self.source_node}.{self.source_port} → {self.target_node}.{self.target_port}"


class PortRegistry:
    """Registry of port connections and values."""
    
    def __init__(self) -> None:
        self.connections: list[PortConnection] = []
        self.values: dict[tuple[str, str], Any] = {}  # (node_id, port_id) → value
    
    def add_connection(
        self,
        source_node: str,
        source_port: str,
        target_node: str,
        target_port: str,
    ) -> None:
        """Register a port connection."""
        conn = PortConnection(source_node, source_port, target_node, target_port)
        self.connections.append(conn)
        sys.stderr.write(f"[PORTS] Connection: {conn}\n")
        sys.stderr.flush()
    
    def set_value(self, node_id: str, port_id: str, value: Any) -> None:
        """Set a port value."""
        key = (node_id, port_id)
        self.values[key] = value
        sys.stderr.write(f"[PORTS] Set {node_id}.{port_id} = {type(value).__name__}\n")
        sys.stderr.flush()
    
    def get_value(self, node_id: str, port_id: str) -> Any | None:
        """Get a port value."""
        key = (node_id, port_id)
        return self.values.get(key)
    
    def get_inputs_for_node(self, node_id: str) -> dict[str, Any]:
        """Get all input values for a node by following connections.
        
        Returns:
            Dictionary mapping target port names to their values
        """
        inputs: dict[str, Any] = {}
        
        for conn in self.connections:
            if conn.target_node == node_id:
                # Look up the source value
                source_value = self.get_value(conn.source_node, conn.source_port)
                if source_value is not None:
                    inputs[conn.target_port] = source_value
        
        sys.stderr.write(f"[PORTS] Inputs for {node_id}: {list(inputs.keys())}\n")
        sys.stderr.flush()
        return inputs
    
    def get_dependents(self, node_id: str) -> set[str]:
        """Get all nodes that depend on this node's outputs."""
        dependents = set()
        for conn in self.connections:
            if conn.source_node == node_id:
                dependents.add(conn.target_node)
        return dependents
    
    def get_dependencies(self, node_id: str) -> set[str]:
        """Get all nodes that this node depends on."""
        dependencies = set()
        for conn in self.connections:
            if conn.target_node == node_id:
                dependencies.add(conn.source_node)
        return dependencies
