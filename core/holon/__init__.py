"""Holon core package.

This package intentionally has no dependency on VS Code or any UI runtime.

Important: `holon.dsl` depends on Pydantic. To keep lightweight entrypoints
like `python -m holon.rpc.server` usable even when only `PYTHONPATH=core/` is
set, we avoid importing DSL symbols eagerly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from holon.__version__ import __version__

__all__ = ["__version__", "Context", "link", "links", "node", "port_map", "spec", "workflow"]


if TYPE_CHECKING:
    from .dsl import Context as Context
    from .dsl import link as link
    from .dsl import links as links
    from .dsl import node as node
    from .dsl import port_map as port_map
    from .dsl import spec as spec
    from .dsl import workflow as workflow


def __getattr__(name: str) -> Any:
    if name in {"Context", "link", "links", "node", "port_map", "spec", "workflow"}:
        from .dsl import Context, link, links, node, port_map, spec, workflow

        return {
            "Context": Context,
            "link": link,
            "links": links,
            "node": node,
            "port_map": port_map,
            "spec": spec,
            "workflow": workflow,
        }[name]
    raise AttributeError(name)
