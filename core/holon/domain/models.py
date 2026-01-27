"""Pydantic domain models for the Holon graph.

Phase 1 scope (per blueprint):
- Node
- Edge
- Position

These models are designed to be stable contracts between parsing, patching, and
the UI/extension layers.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Position(BaseModel):
    """2D position in the editor canvas."""

    model_config = ConfigDict(frozen=True)

    x: float = Field(..., description="X coordinate")
    y: float = Field(..., description="Y coordinate")


class Node(BaseModel):
    """A graph node extracted from source code."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(..., description="Stable unique identifier")
    name: str = Field(..., description="Function name in source code")
    kind: Literal["node", "workflow", "spec"] = Field(..., description="Node role")
    position: Position | None = Field(default=None, description="Optional canvas position")

    # Optional extended metadata for "spec" nodes.
    label: str | None = Field(default=None, description="Optional display label")
    node_type: str | None = Field(default=None, description="Optional node type (e.g. 'langchain.agent')")
    props: dict[str, Any] | None = Field(default=None, description="Optional JSON-serializable configuration")


class Edge(BaseModel):
    """A directed edge between two nodes."""

    model_config = ConfigDict(frozen=True)

    source: str = Field(..., description="Source node id")
    target: str = Field(..., description="Target node id")

    # Optional port-level wiring.
    source_port: str | None = Field(default=None, description="Optional source port id")
    target_port: str | None = Field(default=None, description="Optional target port id")
    kind: Literal["code", "link"] | None = Field(default=None, description="Optional edge kind")


class Graph(BaseModel):
    """A full Holon graph extracted from source code."""

    model_config = ConfigDict(frozen=True)

    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Phase 5.0 (next): "real nodes" via metadata (ports/connectors)
#
# These models represent a shared, JSON-serializable contract for nodes and
# links that are *not* directly encoded in Python source code.
# ---------------------------------------------------------------------------


PortKind = Literal["data", "llm", "memory", "tool", "parser", "control"]


class PortSpec(BaseModel):
    """A typed port/connector on a node.

    Ports are intended to be rendered as connection handles in the UI.
    """

    model_config = ConfigDict(frozen=True)

    id: str = Field(..., description="Stable port id within a node")
    kind: PortKind = Field("data", description="Semantic port kind")
    label: str | None = Field(default=None, description="Optional display label")
    multi: bool = Field(default=False, description="Whether multiple edges can connect")


class NodeSpec(BaseModel):
    """A metadata-defined node (not necessarily backed by a Python function)."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(..., description="Stable unique identifier")
    type: str = Field(..., description="Node type identifier (e.g. 'langchain.agent')")
    label: str = Field(..., description="Display label")
    inputs: list[PortSpec] = Field(default_factory=list, description="Input ports")
    outputs: list[PortSpec] = Field(default_factory=list, description="Output ports")
    props: dict[str, Any] = Field(default_factory=dict, description="JSON-serializable configuration")


class EdgeSpec(BaseModel):
    """A metadata-defined edge between two node ports."""

    model_config = ConfigDict(frozen=True)

    sourceNodeId: str = Field(..., description="Source node id")
    sourcePort: str = Field(..., description="Source port id")
    targetNodeId: str = Field(..., description="Target node id")
    targetPort: str = Field(..., description="Target port id")


class GraphSpec(BaseModel):
    """Metadata graph (nodes + edges) stored outside of user code."""

    model_config = ConfigDict(frozen=True)

    nodes: list[NodeSpec] = Field(default_factory=list)
    edges: list[EdgeSpec] = Field(default_factory=list)
