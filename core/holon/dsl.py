"""Holon DSL (Phase 1 stubs).

These decorators and types are intentionally lightweight: they exist primarily to
provide a stable import surface and a clean developer experience (IDE, typing).

The actual graph extraction is handled by the LibCST-based parser.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, ParamSpec, TypeVar, overload

from pydantic import BaseModel, ConfigDict

P = ParamSpec("P")
R = TypeVar("R")
F = TypeVar("F", bound=Callable[..., Any])


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
        if id is not None:
            setattr(decorated, "__holon_spec_id__", id)
        if label is not None:
            setattr(decorated, "__holon_spec_label__", label)
        return decorated

    # No arguments: direct decoration of a function
    if func is not None:
        if isinstance(func, type):
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


def link(
    source_node_id: str,
    source_port: str,
    target_node_id: str,
    target_port: str,
    /,
) -> None:
    """Declare a link between two node ports.

    This is a Phase 5 stub used by the parser. It has no runtime behavior.

    Args:
        source_node_id: Source node id.
        source_port: Source port id.
        target_node_id: Target node id.
        target_port: Target port id.
    """

    return None
