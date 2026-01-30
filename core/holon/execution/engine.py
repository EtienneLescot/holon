"""Execution engine with graph-based node orchestration."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any

from holon.domain.models import Graph, Node, Edge
from holon.execution.ports import PortRegistry
from holon.execution.resolver import SpecResolver


@dataclass
class ExecutionContext:
    """Context for workflow execution."""
    
    graph: Graph
    port_registry: PortRegistry = field(default_factory=PortRegistry)
    resolver: SpecResolver = field(default_factory=SpecResolver)
    node_outputs: dict[str, Any] = field(default_factory=dict)
    execution_trace: list[dict[str, Any]] = field(default_factory=list)
    error_node_id: str | None = None


class ExecutionEngine:
    """Graph-based execution engine with port data flow.
    
    This engine:
    1. Parses the workflow graph (nodes + edges/links)
    2. Resolves spec nodes to runtime objects
    3. Builds dependency graph from port connections
    4. Executes nodes in topological order
    5. Passes data through ports (input, llm, memory, tools → output)
    """
    
    def __init__(self) -> None:
        pass
    
    async def execute_graph(self, ctx: ExecutionContext) -> Any:
        """Execute a workflow graph.
        
        Args:
            ctx: Execution context with graph and port registry
        
        Returns:
            Output from the workflow entrypoint (or last executed node)
        """
        sys.stderr.write("[ENGINE] Starting graph execution\n")
        sys.stderr.flush()
        
        # Step 1: Register all port connections from edges
        self._register_port_connections(ctx)
        
        # Step 2: Resolve all spec nodes
        self._resolve_spec_nodes(ctx)
        
        # Step 3: Build execution order (topological sort)
        execution_order = self._build_execution_order(ctx)
        sys.stderr.write(f"[ENGINE] Execution order: {execution_order}\n")
        sys.stderr.flush()
        
        # Step 4: Execute nodes in order
        result = await self._execute_nodes(ctx, execution_order)
        
        sys.stderr.write(f"[ENGINE] Graph execution completed\n")
        sys.stderr.flush()
        
        return result
    
    def _register_port_connections(self, ctx: ExecutionContext) -> None:
        """Register all port connections from graph edges."""
        sys.stderr.write("[ENGINE] Registering port connections\n")
        sys.stderr.flush()
        
        for edge in ctx.graph.edges:
            if edge.source_port and edge.target_port:
                ctx.port_registry.add_connection(
                    source_node=edge.source,
                    source_port=edge.source_port,
                    target_node=edge.target,
                    target_port=edge.target_port,
                )
    
    def _resolve_spec_nodes(self, ctx: ExecutionContext) -> None:
        """Resolve all spec nodes in the graph."""
        sys.stderr.write("[ENGINE] Resolving spec nodes\n")
        sys.stderr.flush()
        
        for node in ctx.graph.nodes:
            if node.kind == "spec" and node.node_type:
                try:
                    resolved = ctx.resolver.resolve(
                        node_id=node.id,
                        node_type=node.node_type,
                        props=node.props or {},
                    )
                    # Store resolved object as output on "output" port
                    ctx.port_registry.set_value(node.id, "output", resolved.runtime_object)
                except Exception as e:
                    sys.stderr.write(f"[ENGINE] ERROR resolving {node.id}: {e}\n")
                    sys.stderr.flush()
                    raise
    
    def _build_execution_order(self, ctx: ExecutionContext) -> list[str]:
        """Build topological execution order for nodes.
        
        Strategy:
        1. Spec nodes of type llm.openai, memory, tools are "providers" (already resolved)
        2. Spec nodes of type langchain.agent need to be executed (they consume inputs)
        3. Use topological sort based on port dependencies
        
        Returns:
            List of node IDs in execution order
        """
        # Find nodes that need execution
        executable = []
        for node in ctx.graph.nodes:
            # Skip workflow entrypoint nodes
            if node.id.startswith("workflow:"):
                continue
            
            # Include function nodes
            if node.kind in ("node",):
                executable.append(node.id)
            
            # Include langchain.agent spec nodes (they are executable)
            if node.kind == "spec" and node.node_type == "langchain.agent":
                executable.append(node.id)
        
        # Simple topological sort: nodes with no dependencies first
        ordered = []
        remaining = set(executable)
        
        while remaining:
            # Find nodes with all dependencies satisfied
            ready = []
            for node_id in remaining:
                deps = ctx.port_registry.get_dependencies(node_id)
                # Filter to only executable dependencies
                exec_deps = deps & remaining
                if not exec_deps:
                    ready.append(node_id)
            
            if not ready:
                # Cycle or no progress - just take the first remaining
                ready = [next(iter(remaining))]
            
            ordered.extend(ready)
            remaining -= set(ready)
        
        return ordered
    
    async def _execute_nodes(self, ctx: ExecutionContext, execution_order: list[str]) -> Any:
        """Execute nodes in order with port-based data flow.
        
        Args:
            ctx: Execution context
            execution_order: List of node IDs to execute in order
        
        Returns:
            Result from the last executed node
        """
        result = None
        
        for node_id in execution_order:
            sys.stderr.write(f"[ENGINE] Executing node: {node_id}\n")
            sys.stderr.flush()
            
            # Get node definition
            node = self._find_node(ctx.graph, node_id)
            if not node:
                sys.stderr.write(f"[ENGINE] WARNING: Node {node_id} not found in graph\n")
                sys.stderr.flush()
                ctx.execution_trace.append({
                    "node_id": node_id,
                    "status": "error",
                    "error": "Node not found in graph"
                })
                continue
            
            # Get inputs from connected ports
            inputs = ctx.port_registry.get_inputs_for_node(node_id)
            sys.stderr.write(f"[ENGINE] Node {node_id} inputs: {list(inputs.keys())}\n")
            sys.stderr.flush()
            
            try:
                # Execute node based on type
                # Special case: langchain.agent spec nodes need execution
                if node.kind == "spec" and node.node_type == "langchain.agent":
                    # Execute agent with port inputs
                    output = await self._execute_agent_node(ctx, node, inputs)
                elif node.kind == "spec":
                    # Other spec nodes already resolved, get their output
                    output = ctx.port_registry.get_value(node_id, "output")
                else:
                    # Execute function/workflow node
                    output = await self._execute_node(ctx, node, inputs)
                
                # Store output
                ctx.node_outputs[node_id] = output
                ctx.port_registry.set_value(node_id, "output", output)
                
                # Add to trace
                ctx.execution_trace.append({
                    "node_id": node_id,
                    "status": "success",
                    "error": None
                })
                
                sys.stderr.write(f"[ENGINE] Node {node_id} completed, output type: {type(output).__name__}\n")
                sys.stderr.flush()
                
                result = output
                
            except Exception as e:
                # Capture error
                error_msg = f"{type(e).__name__}: {str(e)}"
                ctx.error_node_id = node_id
                ctx.execution_trace.append({
                    "node_id": node_id,
                    "status": "error",
                    "error": error_msg
                })
                sys.stderr.write(f"[ENGINE] Node {node_id} failed: {error_msg}\n")
                sys.stderr.flush()
                # Re-raise to stop execution
                raise
        
        return result
    
    async def _execute_node(self, ctx: ExecutionContext, node: Node, inputs: dict[str, Any]) -> Any:
        """Execute a single node (function or agent call).
        
        For spec nodes of type langchain.agent, we call the agent runner with port inputs.
        For other nodes, we look up the Python function.
        """
        # Check if this is a spec node that needs special handling
        if node.kind == "spec" and node.node_type == "langchain.agent":
            return await self._execute_agent_node(ctx, node, inputs)
        
        # For other nodes, we'd need to look up the Python function
        # For now, return a placeholder
        sys.stderr.write(f"[ENGINE] Node {node.id} execution not yet implemented for kind={node.kind}\n")
        sys.stderr.flush()
        return f"<executed {node.id}>"
    
    async def _execute_agent_node(self, ctx: ExecutionContext, node: Node, inputs: dict[str, Any]) -> Any:
        """Execute a langchain.agent spec node with port inputs."""
        sys.stderr.write(f"[ENGINE] Executing agent node: {node.id}\n")
        sys.stderr.flush()
        
        # Get the resolved agent runner
        resolved = ctx.resolver.get_cached(node.id)
        if not resolved:
            raise RuntimeError(f"Agent node {node.id} not resolved")
        
        agent_runner = resolved.runtime_object
        
        # Build agent call arguments from port inputs
        # Expected ports: input, llm, tools, memory
        agent_kwargs = {}
        
        # Get input text
        if "input" in inputs:
            agent_kwargs["input"] = inputs["input"]
        else:
            # Use user_prompt from props as fallback
            agent_kwargs["input"] = resolved.props.get("user_prompt", "")
        
        # Get LLM from llm port
        if "llm" in inputs:
            agent_kwargs["llm"] = inputs["llm"]
        
        # Get tools from tools port
        if "tools" in inputs:
            agent_kwargs["tools"] = inputs["tools"]
        
        # Get memory from memory port
        if "memory" in inputs:
            agent_kwargs["memory"] = inputs["memory"]
        
        sys.stderr.write(f"[ENGINE] Agent call args: {list(agent_kwargs.keys())}\n")
        sys.stderr.flush()
        
        # Call the agent runner
        try:
            if callable(agent_runner):
                output = await agent_runner(**agent_kwargs)
            else:
                # Agent runner might be a config object; use it to construct call
                sys.stderr.write(f"[ENGINE] Agent runner is not callable: {type(agent_runner)}\n")
                sys.stderr.flush()
                output = f"<agent {node.id} output>"
            
            return output
        except Exception as e:
            sys.stderr.write(f"[ENGINE] ERROR executing agent {node.id}: {e}\n")
            sys.stderr.flush()
            raise
    
    def _find_node(self, graph: Graph, node_id: str) -> Node | None:
        """Find a node by ID in the graph."""
        for node in graph.nodes:
            if node.id == node_id:
                return node
        return None
