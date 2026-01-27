"""Holon graph parsing utilities (Phase 4.1).

This module extracts a graph model (nodes + edges) from Python source code.

Current scope:
- Nodes: functions decorated with @node and @workflow
- Edges: within each @workflow function body, detect direct calls to known
  node functions, including both `await node_fn(...)` and `node_fn(...)`.

We intentionally keep this conservative and lossless-friendly by using LibCST.
"""

from __future__ import annotations

from dataclasses import dataclass

import libcst as cst

from holon.domain.models import Edge, Graph, Node


def parse_graph(source_code: str) -> Graph:
    """Parse source code into a Holon Graph.

    Args:
        source_code: Python source code.

    Returns:
        Graph containing extracted nodes and edges.

    Raises:
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """

    module = cst.parse_module(source_code)

    node_collector = _HolonFunctionCollector()
    module.visit(node_collector)

    node_names = {n.name for n in node_collector.nodes if n.kind == "node"}

    edge_collector = _WorkflowEdgeCollector(node_names=node_names)
    module.visit(edge_collector)

    return Graph(nodes=node_collector.nodes, edges=edge_collector.edges)


@dataclass(slots=True)
class _HolonFunctionCollector(cst.CSTVisitor):
    nodes: list[Node]

    def __init__(self) -> None:
        self.nodes = []

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        kind = _extract_holon_kind(node)
        if kind is None:
            return None

        function_name = node.name.value
        self.nodes.append(
            Node(
                id=f"{kind}:{function_name}",
                name=function_name,
                kind=kind,
                position=None,
            )
        )
        return None


@dataclass(slots=True)
class _WorkflowEdgeCollector(cst.CSTVisitor):
    node_names: set[str]
    edges: list[Edge]

    _workflow_stack: list[str]
    _seen: set[tuple[str, str]]

    def __init__(self, *, node_names: set[str]) -> None:
        self.node_names = node_names
        self.edges = []
        self._workflow_stack = []
        self._seen = set()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool | None:
        # Avoid descending into nested function defs unless it's the workflow
        # we care about. This keeps edge detection predictable.
        if self._workflow_stack:
            return False

        kind = _extract_holon_kind(node)
        if kind != "workflow":
            return True

        self._workflow_stack.append(node.name.value)
        return True

    def leave_FunctionDef(self, original_node: cst.FunctionDef) -> None:
        if self._workflow_stack and self._workflow_stack[-1] == original_node.name.value:
            self._workflow_stack.pop()

    def visit_Call(self, node: cst.Call) -> None:
        if not self._workflow_stack:
            return None

        # Only handle direct calls: node_fn(...)
        if not isinstance(node.func, cst.Name):
            return None

        callee = node.func.value
        if callee not in self.node_names:
            return None

        workflow_name = self._workflow_stack[-1]
        source_id = f"workflow:{workflow_name}"
        target_id = f"node:{callee}"

        key = (source_id, target_id)
        if key in self._seen:
            return None

        self._seen.add(key)
        self.edges.append(Edge(source=source_id, target=target_id))
        return None


def _extract_holon_kind(node: cst.FunctionDef) -> str | None:
    decorators = [d.decorator for d in node.decorators]
    if any(_decorator_matches(d, "node") for d in decorators):
        return "node"
    if any(_decorator_matches(d, "workflow") for d in decorators):
        return "workflow"
    return None


def _decorator_matches(expr: cst.BaseExpression, decorator_name: str) -> bool:
    target: cst.BaseExpression = expr
    if isinstance(target, cst.Call):
        target = target.func

    if isinstance(target, cst.Name):
        return target.value == decorator_name

    if isinstance(target, cst.Attribute):
        return target.attr.value == decorator_name

    return False
