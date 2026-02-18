"""Holon DSL (Phase 1 stubs).

These decorators and types are intentionally lightweight: they exist primarily to
provide a stable import surface and a clean developer experience (IDE, typing).

The actual graph extraction is handled by the LibCST-based parser.
"""

from __future__ import annotations

import builtins

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, ParamSpec, TypeVar, overload

from pydantic import BaseModel, ConfigDict

P = ParamSpec("P")
R = TypeVar("R")
F = TypeVar("F", bound=Callable[..., Any])


# ============================================================================
# Port Classes for >> Operator Syntax
# ============================================================================

class Port:
    """Base class for node ports.
    
    Ports represent connection points on nodes. When used with the >> operator,
    they create explicit links between nodes in the workflow graph.
    
    Example:
        TriggerChat.out >> LangchainAgent.input
    """
    
    def __init__(self, node_ref: str | type, port_name: str) -> None:
        """Initialize a port.
        
        Args:
            node_ref: Node identifier (class name or node ID string)
            port_name: Port name on the node
        """
        # Store the node reference (can be class name or node ID)
        if isinstance(node_ref, type):
            self.node_ref = node_ref.__name__
        else:
            self.node_ref = node_ref
        self.port_name = port_name
        
        # Track source info for parser
        self._node_class = node_ref if isinstance(node_ref, type) else None

    def __repr__(self) -> str:
        return f"Port({self.node_ref}.{self.port_name})"


class PortOut(Port):
    """Output port that can be connected to an input port using >> operator.
    
    Example:
        TriggerChat.out >> LangchainAgent.input
    """
    
    def __rshift__(self, target: PortIn) -> PortIn:
        """Connect this output port to an input port.
        
        Args:
            target: Target input port to connect to
            
        Returns:
            The target port (allows chaining: A >> B >> C)
        """
        # This is a marker operation - the actual link registration
        # happens at parse time via LibCST in graph_parser.py
        # 
        # We return target to enable chaining: A >> B >> C
        return target


class PortIn(Port):
    """Input port that receives connections from output ports.
    
    Example:
        LangchainAgent.input  # Receives from: TriggerChat.out >> LangchainAgent.input
    """
    
    def __rshift__(self, target: PortIn) -> PortIn:
        """Allow chaining multiple targets.
        
        This enables: source_out >> target1_in >> target2_in
        though this is rare in practice.
        """
        return target


# ============================================================================
# Standard Port Definitions by Node Type
# ============================================================================

# Mapping of node types to their standard ports (inputs and outputs)
# This allows automatic port attachment when using @node decorator
_STANDARD_PORTS: dict[str, dict[str, list[str]]] = {
    "trigger.chat": {
        "inputs": ["response"],  # Special response port for agent replies
        "outputs": ["out"],      # User message output
    },
    "trigger.manual": {
        "inputs": [],
        "outputs": ["start"],
    },
    "langchain.agent": {
        "inputs": ["input", "llm", "memory", "tools", "parser"],
        "outputs": ["output"],
    },
    "llm.model": {
        "inputs": [],
        "outputs": ["output"],
    },
    "langchain.tool": {
        "inputs": ["input"],
        "outputs": ["output"],
    },
    "memory.buffer": {
        "inputs": [],
        "outputs": ["output"],
    },
    # --- Phase 7.0: Flow control & utility nodes ---
    "logic.switch": {
        # 1 input + up to 10 output branches + 1 fallback
        # out_0..out_9 are created on demand via __getattr__; we register
        # the first two plus fallback as static defaults so the >> operator
        # works without declaring rules first.
        "inputs": ["input"],
        "outputs": ["out_0", "out_1", "out_2", "out_3", "out_4",
                    "out_5", "out_6", "out_7", "out_8", "out_9", "out_fallback"],
    },
    "parser.structured": {
        "inputs": [],
        "outputs": ["output"],
    },
    "code.python": {
        "inputs": ["input"],
        "outputs": ["output"],
    },
    "http.request": {
        "inputs": ["input"],
        "outputs": ["output"],
    },
}


class _NodeProxy:
    """Proxy object for node classes that provides .uses() method.
    
    This allows the syntax: AgentNode.uses(llm=GptModel.output)
    for dependency injection / resource binding.
    """
    
    def __init__(self, node_class: type[Any], node_id: str) -> None:
        self._node_class = node_class
        self._node_id = node_id
        self._class_name = node_class.__name__
    
    def uses(self, **kwargs: Port) -> None:
        """Bind resources/dependencies to this node.
        
        This is for dependency injection, NOT data flow.
        
        Example:
            LangchainAgent.uses(llm=LlmModel.output, memory=Memory.output)
        
        Args:
            **kwargs: Named dependencies (port name -> source port)
        """
        # This is a marker operation - the actual binding registration
        # happens at parse time via LibCST in graph_parser.py
        pass
    
    def __getattr__(self, name: str) -> Port:
        """Get port by name for >> operator or uses() method.
        
        This allows both:
            AgentNode.input  # Returns PortIn
            AgentNode.output # Returns PortOut
        """
        # Delegate to the actual class attributes (ports)
        return getattr(self._node_class, name)


def _attach_ports_to_class(cls: type[Any], node_type: str, node_id: str) -> None:
    """Attach port attributes to a node class for >> operator syntax.
    
    This function creates PortOut and PortIn attributes on the class so that
    users can write: TriggerChat.out >> LangchainAgent.input
    It also adds a .uses() method for dependency binding.
    
    Args:
        cls: The class to attach ports to
        node_type: The node type (e.g., "trigger.chat")
        node_id: The node ID (e.g., "node:trigger:chat:main")
    """
    port_config = _STANDARD_PORTS.get(node_type)
    
    if not port_config:
        # Unknown type - don't attach any ports
        # User will need to define them manually if needed
        return
    
    # Attach input ports
    for port_name in port_config.get("inputs", []):
        setattr(cls, port_name, PortIn(node_id, port_name))
    
    # Attach output ports
    for port_name in port_config.get("outputs", []):
        setattr(cls, port_name, PortOut(node_id, port_name))
    
    # Attach .uses() method via a bound method
    proxy = _NodeProxy(cls, node_id)
    setattr(cls, "uses", proxy.uses)


class Context(BaseModel):
    """Execution context passed to nodes.

    Phase 1 uses a minimal model. Later phases can extend this with runtime
    services (logging, tracing, state, secrets, etc.).
    """

    model_config = ConfigDict(extra="allow")


@dataclass(frozen=True, slots=True)
class _DecoratorMetadata:
    kind: str


def _attach_metadata(func: F, *, kind: str) -> F:
    setattr(func, "__holon_decorator__", _DecoratorMetadata(kind=kind))
    return func


@overload
def node(func: Callable[P, R], /) -> Callable[P, R]: ...


@overload
def node(*, name: str | None = None) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


@overload
def node(
    *,
    type: str,  # noqa: A002 - matches the DSL keyword argument
    id: str | None = None,  # noqa: A002 - id is a common param name
    label: str | None = None,
) -> Callable[[type[Any]], type[Any]]: ...


def node(
    func: Callable[P, R] | type[Any] | None = None,
    /,
    *,
    name: str | None = None,
    type: str | None = None,  # noqa: A002 - matches the DSL keyword argument
    id: str | None = None,  # noqa: A002 - id is a common param name
    label: str | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]] | Callable[[type[Any]], type[Any]]:
    """Universal decorator for defining Holon nodes.

    This decorator adapts to context:
    - On a **function** → custom node (inline code).
    - On a **class with type=** → library node (prefabricated, config-based).

    Args:
        func: Function or class to decorate.
        name: Optional explicit node name (functions only).
        type: Node type identifier (classes only, e.g., "llm.model").
        id: Optional node ID (classes only). Defaults to `spec:<type>:<class_name_snake_case>`.
        label: Optional display label (classes only). Defaults to class name.

    Returns:
        The decorated function or class (identity at runtime).

    Examples:
        Custom node (function)::
            @node
            def analyze(x: int) -> int:
                return x + 1

        Library node (class)::
            @node(type="llm.model", id="spec:llm:my_gpt4")
            class MyGPT4:
                model_name = "gpt-4o"
                temperature = 0.7
    """

    def decorator_func(target: Callable[P, R]) -> Callable[P, R]:
        decorated = _attach_metadata(target, kind="node")
        if name is not None:
            setattr(decorated, "__holon_node_name__", name)
        return decorated

    def decorator_class(target: type[Any]) -> type[Any]:
        if type is None:
            msg = "@node on a class requires 'type' parameter (e.g., @node(type='llm.model'))"
            raise TypeError(msg)
        decorated = _attach_metadata(target, kind="node_library")
        setattr(decorated, "__holon_spec_type__", type)
        
        # Determine node ID (use provided id or generate from class name)
        if id is not None:
            node_id = id
            setattr(decorated, "__holon_spec_id__", id)
        else:
            # Generate default ID from class name (convert CamelCase to snake_case)
            import re
            class_name = target.__name__
            snake_case = re.sub(r'(?<!^)(?=[A-Z])', '_', class_name).lower()
            node_id = f"node:{type.replace('.', ':')}:{snake_case}"
        
        if label is not None:
            setattr(decorated, "__holon_spec_label__", label)
        
        # Attach standard ports to the class based on node type
        _attach_ports_to_class(decorated, type, node_id)
        
        return decorated

    # No arguments: direct decoration of a function
    if func is not None:
        if isinstance(func, builtins.type):
            return decorator_class(func)
        return decorator_func(func)

    # With arguments: return appropriate decorator
    if type is not None:
        # Class decoration (library node)
        return decorator_class
    # Function decoration (custom node)
    return decorator_func


@overload
def workflow(func: Callable[P, R], /) -> Callable[P, R]: ...


@overload
def workflow(
    *, name: str | None = None
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def workflow(
    func: Callable[P, R] | None = None,
    /,
    *,
    name: str | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Mark a function as a Holon workflow.

    Workflows are entrypoints that orchestrate calls to nodes.

    Args:
        func: Function to decorate.
        name: Optional explicit workflow name.

    Returns:
        The decorated function (identity at runtime).
    """

    def decorator(target: Callable[P, R]) -> Callable[P, R]:
        decorated = _attach_metadata(target, kind="workflow")
        if name is not None:
            setattr(decorated, "__holon_workflow_name__", name)
        return decorated

    if func is None:
        return decorator

    return decorator(func)


@overload
def links(func: Callable[P, R], /) -> Callable[P, R]: ...


@overload
def links(
    *, name: str | None = None
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def links(
    func: Callable[P, R] | None = None,
    /,
    *,
    name: str | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Mark a function as a Holon links definition.

    Links functions define the connections between nodes using two syntaxes:
    1. Pipeline Flow (>>): Chronological execution path with data payload
       Example: TriggerChat.out >> LangchainAgent.input
    
    2. Dependency Binding (.uses()): Resource/capability injection
       Example: LangchainAgent.uses(llm=LlmModel.output)

    This decorator is particularly useful for separating connection logic
    from execution logic in complex workflows.

    Args:
        func: Function to decorate.
        name: Optional explicit links function name.

    Returns:
        The decorated function (identity at runtime).
        
    Example:
        @links
        def define_routing():
            '''Define workflow connections'''
            # Dependencies
            LangchainAgent.uses(llm=LlmModel.output)
            
            # Data flow
            TriggerChat.out >> LangchainAgent.input
            LangchainAgent.output >> TriggerChat.response
    """

    def decorator(target: Callable[P, R]) -> Callable[P, R]:
        decorated = _attach_metadata(target, kind="links")
        if name is not None:
            setattr(decorated, "__holon_links_name__", name)
        return decorated

    if func is None:
        return decorator

    return decorator(func)


# Convenience types for end-users.
NodeFn = Callable[..., Any]
AsyncNodeFn = Callable[..., Awaitable[Any]]


def spec(
    node_id: str,
    /,
    *,
    type: str,  # noqa: A002 - matches the DSL keyword argument
    label: str | None = None,
    props: dict[str, Any] | None = None,
) -> None:
    """Declare a metadata-defined node in a code-first workflow.

    This is a Phase 5 stub used primarily as a stable surface for the parser
    and for IDE auto-complete. It has no runtime behavior.

    Args:
        node_id: Stable node id (recommended prefix: ``spec:``).
        type: Node type identifier (e.g. ``langchain.agent``).
        label: Optional display label.
        props: Optional JSON-serializable configuration.

    Deprecated:
        Use `@node(type="...", ...)` on a class instead.
    """

    return None


def specify(
    node_id: str,
    /,
    *,
    type: str,
    label: str | None = None,
    **props: Any,
) -> None:
    """Convenience wrapper for declaring a `spec` using keyword props.

    This is an ergonomics helper for code-first workflows: instead of
    constructing a `props` dict inline, callers can pass configuration as
    named keyword arguments which are collected and forwarded to `spec(...)`.

    Example::
        specify("spec:llm:123", type="llm.model", model_name="gpt-4o", temperature=0.7)

    Deprecated:
        Use `@node(type="...", ...)` on a class instead.
    """

    return spec(node_id, type=type, label=label, props=props or None)


C = TypeVar("C", bound=type)


def spec_node(
    *,
    type: str,  # noqa: A002 - matches the DSL keyword argument
    id: str | None = None,  # noqa: A002 - id is a common param name
    label: str | None = None,
) -> Callable[[C], C]:
    """Decorator for defining a spec node via a class.

    This decorator is deprecated in favor of the unified `@node(type="...", ...)`
    which works for both functions (custom nodes) and classes (library nodes).

    Deprecated:
        Use `@node(type="...", ...)` instead.

    Args:
        type: Node type identifier (e.g., "llm.model", "langchain.agent").
        id: Optional node ID. If omitted, derived from class name as
            `spec:<type>:<class_name_snake_case>`.
        label: Optional display label. If omitted, derived from class name.

    Args:
        type: Node type identifier (e.g., "llm.model", "langchain.agent").
        id: Optional node ID. If omitted, derived from class name as
            `spec:<type>:<class_name_snake_case>`.
        label: Optional display label. If omitted, derived from class name.

    Example::
        @spec_node(type="llm.model", id="spec:llm:my_gpt4")
        class MyGPT4:
            model_name = "gpt-4o"
            temperature = 0.7

    The parser extracts class attributes (non-private, non-callable) and
    converts them into a `props` dict at graph generation time.
    """

    def decorator(cls: C) -> C:
        decorated = _attach_metadata(cls, kind="spec_node")
        setattr(decorated, "__holon_spec_type__", type)
        if id is not None:
            setattr(decorated, "__holon_spec_id__", id)
        if label is not None:
            setattr(decorated, "__holon_spec_label__", label)
        return decorated

    return decorator


@overload
def link(
    source_node_id: str,
    source_port: str,
    target_node_id: str,
    target_port: str,
    /,
) -> None: ...


@overload
def link(cls: type[Any], /) -> type[Any]: ...


def link(
    source_node_id: str | type[Any] | None = None,
    source_port: str | None = None,
    target_node_id: str | None = None,
    target_port: str | None = None,
    /,
) -> None | type[Any] | Callable[[type[Any]], type[Any]]:
    """Declare a link between two node ports.

    Can be used in two ways:
    1. As a function call (deprecated): `link("node:a", "out", "node:b", "in")`
    2. As a decorator (recommended): `@link` on a class with `source` and `target` attributes.

    Decorator usage (code-first)::
        @link
        class _:
            source = (analyze, "output")
            target = (LangChainAgent3, "input")

    Args:
        source_node_id: Source node id (function call form).
        source_port: Source port id (function call form).
        target_node_id: Target node id (function call form).
        target_port: Target port id (function call form).

    Returns:
        None (function call form) or decorated class (decorator form).

    Deprecated:
        Function call form is deprecated. Use `@link` decorator on a class instead.
    """

    # Decorator form: first argument is a class
    if isinstance(source_node_id, type):
        cls = source_node_id
        decorated = _attach_metadata(cls, kind="link")
        # Parser will extract source/target attributes at parse time
        return decorated

    # Function call form (deprecated)
    if source_node_id is not None and source_port is not None:
        return None

    # No arguments: return decorator
    def decorator(cls: type[Any]) -> type[Any]:
        return _attach_metadata(cls, kind="link")

    return decorator


def port_map(cls: type[Any], /) -> type[Any]:
    """Declare a port mapping with optional data transformation.
    
    Port mappings define how data should be extracted, transformed, and routed
    from a source port to a target port using the DataEnvelope transport format.
    
    Usage::
        @port_map
        class _:
            source = (ChatNode, "out.message")
            target = (AgentNode, "in.prompt")
            transform = "$.content"       # JSONPath to extract content field
            target_field = "user"         # Inject into prompt.user
            on_error = "stop"             # Error handling: "stop" | "skip" | "pass"
    
    Attributes:
        source (tuple): Source node reference and port name
        target (tuple): Target node reference and port name
        transform (str | None): Transformation expression (JSONPath, template, or lambda)
        target_field (str | None): Target field for nested injection
        when (str | None): Conditional filter expression (optional)
        on_error (str): Error handling behavior - "stop" (default), "skip", or "pass"
    
    Supported transform languages:
        - JSONPath: "$.content", "$.metadata.role"
        - Templates: "User: {{content}}", "{{metadata.role}}: {{content}}"
        - Python lambda: "lambda env: env.content.upper()"
    
    Example - Extract message content::
        @port_map
        class _:
            source = (ChatNode, "out.message")
            target = (AgentNode, "in.prompt")
            transform = "$.content"
            target_field = "user"
    
    Example - Template interpolation::
        @port_map
        class _:
            source = (ChatNode, "out.message")
            target = (DisplayNode, "in.text")
            transform = "{{metadata.role}}: {{content}}"
    
    Example - Python transformation::
        @port_map
        class _:
            source = (AgentNode, "out.response")
            target = (ChatNode, "in.message")
            transform = "lambda env: DataEnvelope(type='message', content=env.content, metadata={'role': 'assistant'})"
    
    Args:
        cls: Class with mapping attributes (typically an anonymous `class _:`)
    
    Returns:
        The decorated class with mapping metadata attached
    """
    return _attach_metadata(cls, kind="port_map")


