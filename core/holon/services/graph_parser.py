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

    spec_collector = _SpecNodeCollector()
    module.visit(spec_collector)

    node_names = {n.name for n in node_collector.nodes if n.kind == "node"}

    edge_collector = _WorkflowEdgeCollector(node_names=node_names)
    module.visit(edge_collector)

    link_collector = _WorkflowLinkCollector()
    module.visit(link_collector)

    return Graph(
        nodes=[*node_collector.nodes, *spec_collector.nodes],
        edges=[*edge_collector.edges, *link_collector.edges],
    )


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
        self.edges.append(Edge(source=source_id, target=target_id, kind="code"))
        return None


@dataclass(slots=True)
class _SpecNodeCollector(cst.CSTVisitor):
    """Collect metadata-defined nodes declared via `spec(...)` at module level."""

    nodes: list[Node]

    def __init__(self) -> None:
        self.nodes = []

    def visit_Module(self, node: cst.Module) -> None:
        # We only care about module-level statements; no need to descend.
        for stmt in node.body:
            call = _extract_call_from_simple_stmt(stmt)
            if call is None:
                continue

            if not _call_matches(call.func, "spec"):
                continue

            spec_node = _parse_spec_call(call)
            if spec_node is None:
                continue

            self.nodes.append(spec_node)


@dataclass(slots=True)
class _WorkflowLinkCollector(cst.CSTVisitor):
    """Collect explicit port links declared via `link(...)` inside workflows."""

    edges: list[Edge]
    _workflow_stack: list[str]
    _seen: set[tuple[str, str, str, str]]

    def __init__(self) -> None:
        self.edges = []
        self._workflow_stack = []
        self._seen = set()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool | None:
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

        if not _call_matches(node.func, "link"):
            return None

        link = _parse_link_call(node)
        if link is None:
            return None

        key = (link.source, link.source_port or "", link.target, link.target_port or "")
        if key in self._seen:
            return None
        self._seen.add(key)
        self.edges.append(link)
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


def _extract_call_from_simple_stmt(stmt: cst.BaseStatement) -> cst.Call | None:
    # Handle `expr` and `x = expr` forms.
    if not isinstance(stmt, cst.SimpleStatementLine):
        return None
    if len(stmt.body) != 1:
        return None

    inner = stmt.body[0]
    if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.Call):
        return inner.value
    if isinstance(inner, cst.Assign) and isinstance(inner.value, cst.Call):
        return inner.value
    return None


def _call_matches(expr: cst.BaseExpression, name: str) -> bool:
    target: cst.BaseExpression = expr
    if isinstance(target, cst.Name):
        return target.value == name
    if isinstance(target, cst.Attribute):
        return target.attr.value == name
    return False


def _parse_spec_call(call: cst.Call) -> Node | None:
    # spec(node_id: str, *, type: str, label?: str, props?: dict)
    if not call.args:
        return None

    node_id = _string_arg_value(call.args[0])
    if node_id is None:
        return None

    type_value: str | None = None
    label_value: str | None = None
    props_value: dict[str, object] | None = None

    for a in call.args[1:]:
        if a.keyword is None:
            continue
        k = a.keyword.value
        if k == "type":
            type_value = _string_expr_value(a.value)
        if k == "label":
            label_value = _string_expr_value(a.value)
        if k == "props":
            props_value = _jsonish_dict_literal(a.value)

    if type_value is None:
        return None

    return Node(
        id=node_id,
        name=label_value or node_id,
        kind="spec",
        position=None,
        label=label_value,
        node_type=type_value,
        props=props_value if props_value is not None else None,
    )


def _parse_link_call(call: cst.Call) -> Edge | None:
    # link(source_node_id, source_port, target_node_id, target_port)
    if len(call.args) < 4:
        return None
    src = _string_arg_value(call.args[0])
    src_port = _string_arg_value(call.args[1])
    tgt = _string_arg_value(call.args[2])
    tgt_port = _string_arg_value(call.args[3])
    if src is None or src_port is None or tgt is None or tgt_port is None:
        return None
    return Edge(
        source=src,
        target=tgt,
        source_port=src_port,
        target_port=tgt_port,
        kind="link",
    )


def _string_arg_value(arg: cst.Arg) -> str | None:
    return _string_expr_value(arg.value)


def _string_expr_value(expr: cst.BaseExpression) -> str | None:
    if isinstance(expr, cst.SimpleString):
        try:
            return expr.evaluated_value
        except Exception:
            return None
    return None


def _jsonish_dict_literal(expr: cst.BaseExpression) -> dict[str, object] | None:
    if isinstance(expr, cst.Name) and expr.value == "None":
        return None
    if not isinstance(expr, cst.Dict):
        return None

    out: dict[str, object] = {}
    for el in expr.elements:
        if el is None:
            return None
        key_expr = el.key
        val_expr = el.value
        if key_expr is None:
            return None
        key = _string_expr_value(key_expr)
        if key is None:
            return None
        val = _jsonish_value(val_expr)
        if val is _NOT_JSONISH:
            return None
        out[key] = val
    return out


class _NotJsonish:
    pass


_NOT_JSONISH = _NotJsonish()


def _jsonish_value(expr: cst.BaseExpression) -> object | _NotJsonish:
    if isinstance(expr, cst.SimpleString):
        try:
            return expr.evaluated_value
        except Exception:
            return _NOT_JSONISH
    if isinstance(expr, cst.Integer):
        try:
            return int(expr.value)
        except Exception:
            return _NOT_JSONISH
    if isinstance(expr, cst.Float):
        try:
            return float(expr.value)
        except Exception:
            return _NOT_JSONISH
    if isinstance(expr, cst.Name):
        if expr.value == "True":
            return True
        if expr.value == "False":
            return False
        if expr.value == "None":
            return None
    if isinstance(expr, cst.List):
        items: list[object] = []
        for el in expr.elements:
            v = _jsonish_value(el.value)
            if v is _NOT_JSONISH:
                return _NOT_JSONISH
            items.append(v)
        return items
    if isinstance(expr, cst.Dict):
        d = _jsonish_dict_literal(expr)
        return _NOT_JSONISH if d is None else d
    return _NOT_JSONISH
