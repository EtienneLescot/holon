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
