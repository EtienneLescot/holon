"""Workflow execution engine with port-based data flow.

This module provides:
- Graph-based execution with topological ordering
- Spec node resolution (llm, agent, tools, memory)
- Port-based data flow between nodes
- Proper logging and error handling

Architecture:
- engine.py: Main execution orchestrator
- resolver.py: Spec node resolution with port discovery
- ports.py: Port management and data flow
"""

from __future__ import annotations

from holon.execution.engine import ExecutionEngine, ExecutionContext

__all__ = ["ExecutionEngine", "ExecutionContext"]
