"""Execution engine with graph-based node orchestration."""

from __future__ import annotations

import inspect
import json
import sys
from dataclasses import dataclass, field
from typing import Any

from holon.domain.models import Graph, Node, Edge, DataEnvelope
from holon.execution.ports import PortRegistry
from holon.execution.resolver import SpecResolver
from holon.execution.mapper import PortMapper

# ---------------------------------------------------------------------------
# Spec types that need to be *executed* (not just resolved as providers)
# ---------------------------------------------------------------------------

#: Spec node types that produce output by running logic at execution time.
#: All other spec types (llm.model, trigger.*, memory.*, parser.structured, …)
#: are pure providers — they are already resolved and stored on the port
#: registry before execution begins.
EXECUTABLE_SPEC_TYPES: frozenset[str] = frozenset({
    "langchain.agent",
    "logic.switch",
    "code.python",
    "http.request",
})


@dataclass
class ExecutionContext:
    """Context for workflow execution."""
    
    graph: Graph
    port_registry: PortRegistry = field(default_factory=PortRegistry)
    resolver: SpecResolver = field(default_factory=SpecResolver)
    node_outputs: dict[str, Any] = field(default_factory=dict)
    execution_trace: list[dict[str, Any]] = field(default_factory=list)
    error_node_id: str | None = None
    trigger_data: dict[str, Any] | None = None  # Initial data from trigger
    response_data: dict[str, Any] | None = None  # Response data for trigger response port
    #: Optional reference to the loaded module namespace (used for inline_code nodes)
    module_namespace: dict[str, Any] | None = None


class ExecutionEngine:
    """Graph-based execution engine with port data flow.
    
    This engine:
    1. Parses the workflow graph (nodes + edges/links)
    2. Resolves spec nodes to runtime objects
    3. Builds dependency graph from port connections
    4. Executes nodes in topological order
    5. Passes data through ports (input, llm, memory, tools → output)
    6. Applies port mappings and transformations
    """
    
    def __init__(self) -> None:
        self.mapper = PortMapper()
    
    async def execute_graph(self, ctx: ExecutionContext) -> Any:
        """Execute a workflow graph.
        
        Args:
            ctx: Execution context with graph and port registry
        
        Returns:
            Output from the workflow entrypoint (or last executed node)
        """
        sys.stderr.write("[ENGINE] Starting graph execution\n")
        sys.stderr.flush()
        
        # Step 0: Inject trigger initial data if provided
        if ctx.trigger_data:
            sys.stderr.write(f"[ENGINE] Injecting trigger data: {list(ctx.trigger_data.keys())}\n")
            sys.stderr.flush()
            for node_id, data in ctx.trigger_data.items():
                # Set the output port of the trigger node with initial data
                injected_value = data
                if isinstance(data, dict) and "type" in data and "content" in data:
                    try:
                        injected_value = DataEnvelope.model_validate(data)
                    except Exception:
                        injected_value = data

                ctx.port_registry.set_value(node_id, "out", injected_value)
                sys.stderr.write(f"[ENGINE] Injected data for trigger {node_id}.out\n")
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
        
        # Step 5: Capture response data from trigger response port
        if ctx.trigger_data:
            for node_id in ctx.trigger_data.keys():
                # Check if this trigger has a response port
                trigger_inputs = ctx.port_registry.get_inputs_for_node(node_id)
                response_value = trigger_inputs.get("response")
                if response_value is not None:
                    if ctx.response_data is None:
                        ctx.response_data = {}

                    if isinstance(response_value, DataEnvelope):
                        serialized = response_value.model_dump(mode="json")
                    else:
                        serialized = response_value

                    ctx.response_data[node_id] = serialized
                    sys.stderr.write(f"[ENGINE] Captured response data from {node_id}.response\n")
                    sys.stderr.flush()
        
        sys.stderr.write(f"[ENGINE] Graph execution completed\n")
        sys.stderr.flush()
        
        return result
    
    def _register_port_connections(self, ctx: ExecutionContext) -> None:
        """Register all port connections from graph edges."""
        sys.stderr.write("[ENGINE] Registering port connections\n")
        sys.stderr.flush()
        
        # Build mapping from class name to node ID
        # (Parser returns class names in edges, but runtime uses node IDs)
        name_to_id = {node.name: node.id for node in ctx.graph.nodes}
        
        for edge in ctx.graph.edges:
            if edge.source_port and edge.target_port:
                # Map class names to node IDs
                source_id = name_to_id.get(edge.source, edge.source)
                target_id = name_to_id.get(edge.target, edge.target)
                
                ctx.port_registry.add_connection(
                    source_node=source_id,
                    source_port=edge.source_port,
                    target_node=target_id,
                    target_port=edge.target_port,
                )
                sys.stderr.write(f"[ENGINE] Registered: {source_id}.{edge.source_port} -> {target_id}.{edge.target_port}\n")
                sys.stderr.flush()
    
    def _resolve_spec_nodes(self, ctx: ExecutionContext) -> None:
        """Resolve all spec nodes in the graph."""
        sys.stderr.write("[ENGINE] Resolving spec nodes\n")
        sys.stderr.flush()
        
        for node in ctx.graph.nodes:
            # Resolve all nodes with kind='spec' (declarative configs)
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
        1. Provider spec nodes (llm.model, memory, parser.structured, …) are
           already resolved — they are NOT added to the executable list.
        2. Executable spec nodes (langchain.agent, logic.switch, code.python,
           http.request) and inline_code nodes ARE executed in topological order.
        
        Returns:
            List of node IDs in execution order
        """
        # Find nodes that need execution
        executable = []
        for node in ctx.graph.nodes:
            # Include inline_code nodes (@node functions)
            if node.kind == "inline_code":
                executable.append(node.id)

            # Include spec nodes that actively process data
            if node.kind == "spec" and node.node_type in EXECUTABLE_SPEC_TYPES:
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

            # ---- Dead-branch skip logic -----------------------------------------------
            # If this node has no data arriving on any of its connected input ports
            # AND it is not a langchain.agent (which may have side-effects / prompts),
            # treat it as a dead branch (e.g. the non-activated branch of a Switch)
            # and skip execution entirely.
            raw_inputs = ctx.port_registry.get_inputs_for_node(node_id)
            if not raw_inputs and node.node_type not in ("langchain.agent", None):
                sys.stderr.write(
                    f"[ENGINE] Skipping {node_id} — no inputs (dead branch)\n"
                )
                sys.stderr.flush()
                ctx.execution_trace.append({"node_id": node_id, "status": "skipped"})
                continue
            # ---------------------------------------------------------------------------
            
            sys.stderr.write(f"[ENGINE] Node {node_id} raw inputs: {list(raw_inputs.keys())}\n")
            sys.stderr.flush()
            
            # Apply port mappings (transformations)
            mapped_inputs = self._apply_port_mappings(ctx, node_id, raw_inputs)
            sys.stderr.write(f"[ENGINE] Node {node_id} mapped inputs: {list(mapped_inputs.keys())}\n")
            sys.stderr.flush()
            
            try:
                # ---- Switch: handles its own port writes; skip generic output wrap ----
                if node.node_type == "logic.switch":
                    await self._execute_switch_node(ctx, node, mapped_inputs)
                    ctx.node_outputs[node_id] = None
                    ctx.execution_trace.append({
                        "node_id": node_id,
                        "status": "success",
                        "error": None,
                        "output": None,
                    })
                    sys.stderr.write(f"[ENGINE] Switch {node_id} done\n")
                    sys.stderr.flush()
                    continue  # Skip generic output wrapping

                # ---- Standard execution path ------------------------------------------
                if node.kind == "spec" and node.node_type == "langchain.agent":
                    output = await self._execute_agent_node(ctx, node, mapped_inputs)
                elif node.kind == "spec" and node.node_type in EXECUTABLE_SPEC_TYPES:
                    output = await self._execute_callable_node(ctx, node, mapped_inputs)
                elif node.kind == "spec":
                    # Provider nodes (llm.model, trigger.*, memory.*, etc.) — already resolved
                    output = ctx.port_registry.get_value(node_id, "output")
                elif node.kind == "inline_code":
                    output = await self._execute_inline_code_node(ctx, node, mapped_inputs)
                else:
                    sys.stderr.write(f"[ENGINE] Unknown node kind: {node.kind}\n")
                    sys.stderr.flush()
                    continue
                
                # Wrap output in DataEnvelope if not already wrapped
                if not isinstance(output, DataEnvelope):
                    if node.node_type == "langchain.agent":
                        envelope_type = "message"
                        metadata = {"role": "assistant"}
                    else:
                        envelope_type = "data"
                        metadata = {}

                    output_envelope = DataEnvelope(
                        type=envelope_type,
                        content=output,
                        metadata=metadata,
                        origin={"nodeId": node_id, "port": "output"}
                    )
                else:
                    output_envelope = output
                
                # Store output
                ctx.node_outputs[node_id] = output
                ctx.port_registry.set_value(node_id, "output", output_envelope)

                ctx.execution_trace.append({
                    "node_id": node_id,
                    "status": "success",
                    "error": None,
                    "output": _serialize_output(output)
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

    def _apply_port_mappings(
        self, 
        ctx: ExecutionContext, 
        node_id: str, 
        raw_inputs: dict[str, Any]
    ) -> dict[str, Any]:
        """Apply port mappings to transform input data.
        
        Args:
            ctx: Execution context
            node_id: Target node identifier
            raw_inputs: Raw input values from connected ports
            
        Returns:
            Transformed input values after applying mappings
        """
        mapped_inputs = {}
        
        for port_name, value in raw_inputs.items():
            # Check if there's a mapping for this port
            mapping = ctx.port_registry.get_mapping(node_id, port_name)
            
            if mapping:
                sys.stderr.write(
                    f"[ENGINE] Applying mapping for {node_id}.{port_name} "
                    f"(transform={mapping.transform})\n"
                )
                sys.stderr.flush()
                
                try:
                    # Ensure value is a DataEnvelope
                    if not isinstance(value, DataEnvelope):
                        envelope = DataEnvelope(
                            type="data",
                            content=value,
                            contentType="application/json"
                        )
                    else:
                        envelope = value
                    
                    # Apply transformation
                    transformed = self.mapper.apply_transform(envelope, mapping.transform)
                    
                    # Handle target_field injection
                    if mapping.target_field:
                        # Inject into a sub-field
                        if port_name not in mapped_inputs:
                            mapped_inputs[port_name] = {}
                        mapped_inputs[port_name][mapping.target_field] = transformed
                    else:
                        # Direct assignment
                        mapped_inputs[port_name] = transformed
                        
                except Exception as e:
                    # Handle errors based on on_error policy
                    error_msg = f"Mapping error: {e}"
                    sys.stderr.write(f"[ENGINE] {error_msg}\n")
                    sys.stderr.flush()
                    
                    if mapping.on_error == "stop":
                        raise
                    elif mapping.on_error == "skip":
                        continue  # Skip this input
                    elif mapping.on_error == "pass":
                        mapped_inputs[port_name] = value  # Pass through unchanged
            else:
                # No mapping - pass value through
                mapped_inputs[port_name] = value
        
        return mapped_inputs
    
    # ------------------------------------------------------------------
    # Execution handlers
    # ------------------------------------------------------------------

    async def _execute_callable_node(
        self, ctx: ExecutionContext, node: Node, inputs: dict[str, Any]
    ) -> Any:
        """Execute a spec node whose resolver returned an async callable.

        Used for ``code.python`` and ``http.request`` — both resolvers return
        ``async def execute(data) -> Any``.
        """
        resolved = ctx.resolver.get_cached(node.id)
        if not resolved:
            raise RuntimeError(f"Node {node.id} not resolved")

        executor = resolved.runtime_object
        data = _unwrap(inputs.get("input"))

        sys.stderr.write(
            f"[ENGINE] Callable node {node.id} ({node.node_type}) "
            f"data type={type(data).__name__}\n"
        )
        sys.stderr.flush()

        if callable(executor):
            timeout = getattr(executor, "__holon_timeout__", None)
            if inspect.iscoroutinefunction(executor):
                coro = executor(data)
                if timeout:
                    import asyncio
                    return await asyncio.wait_for(coro, timeout=timeout)
                return await coro
            else:
                return executor(data)
        else:
            raise RuntimeError(
                f"Resolved object for {node.id} ({node.node_type}) is not callable. "
                f"Got: {type(executor).__name__}"
            )

    async def _execute_inline_code_node(
        self, ctx: ExecutionContext, node: Node, inputs: dict[str, Any]
    ) -> Any:
        """Execute a @node-decorated Python function (inline_code kind).

        The function is retrieved from ``ctx.module_namespace`` which is
        populated by the runner when it loads the workflow module.
        """
        if ctx.module_namespace is None:
            sys.stderr.write(
                f"[ENGINE] inline_code node {node.id}: module_namespace not set; "
                f"returning placeholder\n"
            )
            sys.stderr.flush()
            return f"<executed {node.id}>"

        func = ctx.module_namespace.get(node.name)
        if func is None:
            raise RuntimeError(
                f"inline_code node '{node.name}' not found in module namespace"
            )

        data = _unwrap(inputs.get("input")) if inputs else None

        sys.stderr.write(
            f"[ENGINE] Calling inline function '{node.name}' "
            f"data type={type(data).__name__}\n"
        )
        sys.stderr.flush()

        if inspect.iscoroutinefunction(func):
            return await func(data)
        else:
            return func(data)
    
    async def _execute_switch_node(
        self, ctx: ExecutionContext, node: Node, inputs: dict[str, Any]
    ) -> None:
        """Evaluate Switch rules and write the data to the matching output port.

        Writes directly to the port registry instead of returning an output,
        because the Switch may activate any one of up to 10+1 ports.
        """
        from holon.library.logic_nodes import evaluate_rule
        from holon.library.template import evaluate_expression

        envelope = inputs.get("input")
        content = _unwrap(envelope)

        props = node.props or {}
        input_expression: str = props.get("input_expression", "{{ data }}")
        rules: list[dict] = props.get("rules", [])
        fallback_port: str = props.get("fallback", "out_fallback")

        # Evaluate the expression on the incoming content
        ctx_data = content if isinstance(content, dict) else {"value": content}
        evaluated = evaluate_expression(input_expression, ctx_data)

        sys.stderr.write(
            f"[SWITCH] {node.id}: expression={input_expression!r} "
            f"evaluated={evaluated!r} ({type(evaluated).__name__})\n"
        )
        sys.stderr.flush()

        # Test rules in order — first match wins
        activated_port: str = fallback_port
        for i, rule in enumerate(rules):
            operator = rule.get("operator", "equals")
            rule_value = rule.get("value")
            out_port = rule.get("output", f"out_{i}")

            if evaluate_rule(evaluated, operator, rule_value):
                activated_port = out_port
                sys.stderr.write(
                    f"[SWITCH] Rule {i} matched ({operator}={rule_value!r}) "
                    f"→ {activated_port}\n"
                )
                sys.stderr.flush()
                break
        else:
            sys.stderr.write(
                f"[SWITCH] No rule matched → fallback={fallback_port}\n"
            )
            sys.stderr.flush()

        # Write the (unchanged) envelope to the activated output port
        ctx.port_registry.set_value(node.id, activated_port, envelope)

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
        # Expected ports: input, llm, tools, memory, parser
        agent_kwargs: dict[str, Any] = {}
        
        # Get input text
        if "input" in inputs:
            input_value = _unwrap(inputs["input"])
            agent_kwargs["input"] = "" if input_value is None else str(input_value)
        else:
            # Use user_prompt from props as fallback
            agent_kwargs["input"] = resolved.props.get("user_prompt", "")
        
        # Get LLM from llm port
        if "llm" in inputs:
            agent_kwargs["llm"] = _unwrap(inputs["llm"])
        
        # Get tools from tools port
        if "tools" in inputs:
            agent_kwargs["tools"] = _unwrap(inputs["tools"])
        
        # Get memory from memory port
        if "memory" in inputs:
            agent_kwargs["memory"] = _unwrap(inputs["memory"])

        # Get structured output parser from parser port (Phase 7.0)
        if "parser" in inputs:
            agent_kwargs["output_parser"] = _unwrap(inputs["parser"])
        
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


def _unwrap(value: Any) -> Any:
    """Unwrap a DataEnvelope or envelope dict to its raw content."""
    if isinstance(value, DataEnvelope):
        return value.content
    if isinstance(value, dict) and "content" in value:
        return value["content"]
    return value


def _serialize_output(value: Any) -> Any:
    """Best-effort JSON-serializable output for execution traces."""
    if isinstance(value, DataEnvelope):
        return value.model_dump()
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump()  # type: ignore[call-arg]
        except Exception:
            pass
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_serialize_output(v) for v in value]
    if isinstance(value, tuple):
        return [_serialize_output(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _serialize_output(v) for k, v in value.items()}
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)
