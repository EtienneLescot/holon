"""Holon core package.

This package intentionally has no dependency on VS Code or any UI runtime.

Important: `holon.dsl` depends on Pydantic. To keep lightweight entrypoints
like `python -m holon.rpc.server` usable even when only `PYTHONPATH=core/` is
set, we avoid importing DSL symbols eagerly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

__all__ = ["Context", "node", "workflow"]


if TYPE_CHECKING:
    from .dsl import Context as Context
    from .dsl import node as node
    from .dsl import workflow as workflow


def __getattr__(name: str) -> Any:
    if name in {"Context", "node", "workflow"}:
        from .dsl import Context, node, workflow

        return {"Context": Context, "node": node, "workflow": workflow}[name]
    raise AttributeError(name)
