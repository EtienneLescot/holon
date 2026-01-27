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


def node(
    func: Callable[P, R] | None = None,
    /,
    *,
    name: str | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Mark a function as a Holon node.

    This is a stub decorator used by the IDE and by the source parser.

    Args:
        func: Function to decorate.
        name: Optional explicit node name.

    Returns:
        The decorated function (identity at runtime).
    """

    def decorator(target: Callable[P, R]) -> Callable[P, R]:
        decorated = _attach_metadata(target, kind="node")
        if name is not None:
            setattr(decorated, "__holon_node_name__", name)
        return decorated

    if func is None:
        return decorator

    return decorator(func)


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
    """

    return None


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
