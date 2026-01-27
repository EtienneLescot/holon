"""Pydantic domain models for the Holon graph.

Phase 1 scope (per blueprint):
- Node
- Edge
- Position

These models are designed to be stable contracts between parsing, patching, and
the UI/extension layers.
"""

from __future__ import annotations

from typing import Literal

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
    kind: Literal["node", "workflow"] = Field(..., description="Node role")
    position: Position | None = Field(default=None, description="Optional canvas position")


class Edge(BaseModel):
    """A directed edge between two nodes."""

    model_config = ConfigDict(frozen=True)

    source: str = Field(..., description="Source node id")
    target: str = Field(..., description="Target node id")
