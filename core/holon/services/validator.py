"""Graph validation utilities.

Validates workflow graphs for structural correctness and business rules.
"""

from __future__ import annotations

from holon.domain.models import Graph


class ValidationError(Exception):
    """Raised when graph validation fails."""
    pass


def validate_graph(graph: Graph, strict: bool = True) -> None:
    """Validate a workflow graph.
    
    Checks:
    - Exactly one trigger node exists (only in strict mode)
    
    Args:
        graph: The graph to validate
        strict: If True, enforce strict validation rules (required for execution).
                If False, allow flexible validation for editing (0 or 1 trigger allowed).
        
    Raises:
        ValidationError: If validation fails
    """
    if strict:
        validate_single_trigger(graph)
    else:
        validate_trigger_editing(graph)
    # TODO: validate_required_ports needs to use registry to resolve NodeSpec


def validate_single_trigger(graph: Graph) -> None:
    """Ensure exactly one trigger exists in the workflow.
    
    A node is considered a trigger if its type starts with "trigger.".
    
    Args:
        graph: The graph to validate
        
    Raises:
        ValidationError: If zero or multiple triggers are found
    """
    triggers = [node for node in graph.nodes if node.node_type and node.node_type.startswith("trigger.")]
    
    if len(triggers) == 0:
        raise ValidationError("Workflow must have exactly one trigger node (type starting with 'trigger.')")
    
    if len(triggers) > 1:
        trigger_ids = [t.id for t in triggers]
        raise ValidationError(f"Workflow can only have one trigger, found {len(triggers)}: {', '.join(trigger_ids)}")


def validate_trigger_editing(graph: Graph) -> None:
    """Validate triggers during editing (more permissive).
    
    Allows 0 or 1 trigger to support intermediate editing states.
    
    Args:
        graph: The graph to validate
        
    Raises:
        ValidationError: If multiple triggers are found
    """
    triggers = [node for node in graph.nodes if node.node_type and node.node_type.startswith("trigger.")]
    
    if len(triggers) > 1:
        trigger_ids = [t.id for t in triggers]
        raise ValidationError(f"Workflow can only have one trigger, found {len(triggers)}: {', '.join(trigger_ids)}")


def validate_required_ports(graph: Graph) -> None:
    """Ensure all required input ports are connected.
    
    Checks that nodes with required_inputs have those ports connected.
    
    Args:
        graph: The graph to validate
        
    Raises:
        ValidationError: If required ports are not connected
    """
    # Build a map of which ports are connected
    connected_ports: dict[tuple[str, str], bool] = {}
    
    for edge in graph.edges:
        # Mark target port as connected
        target_key = (edge.target, edge.target_port or "input")
        connected_ports[target_key] = True
    
    # Check each node's required inputs
    errors: list[str] = []
    
    for node in graph.nodes:
        if not hasattr(node, 'required_inputs') or not node.required_inputs:
            continue
            
        for required_port in node.required_inputs:
            port_key = (node.id, required_port)
            if port_key not in connected_ports:
                errors.append(f"Node '{node.id}' requires connection to port '{required_port}'")
    
    if errors:
        raise ValidationError("Required ports not connected:\n  " + "\n  ".join(errors))
