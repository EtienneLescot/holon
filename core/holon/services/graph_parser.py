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

from holon.domain.models import Edge, Graph, Node, PortMapping


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
    
    class_node_collector = _NodeClassCollector()
    module.visit(class_node_collector)

    # Legacy: Direct function calls in workflow bodies creating edges
    # Now we use @link declarations instead, so this is disabled
    # node_names = {n.name for n in node_collector.nodes if n.kind == "node"}
    # edge_collector = _WorkflowEdgeCollector(node_names=node_names)
    # module.visit(edge_collector)

    link_collector = _WorkflowLinkCollector()
    module.visit(link_collector)

    link_class_collector = _LinkClassCollector()
    module.visit(link_class_collector)
    
    # New: >> operator link syntax
    rshift_collector = _RShiftLinkCollector()
    module.visit(rshift_collector)
    
    # New: .uses() dependency binding syntax
    uses_collector = _UsesBindingCollector()
    module.visit(uses_collector)

    return Graph(
        nodes=[*node_collector.nodes, *spec_collector.nodes, *class_node_collector.nodes],
        edges=[*link_collector.edges, *link_class_collector.edges, *rshift_collector.edges, *uses_collector.edges],
    )


def parse_port_maps(source_code: str) -> list[PortMapping]:
    """Parse @port_map declarations from source code.
    
    Args:
        source_code: Python source code containing @port_map decorators
        
    Returns:
        List of PortMapping objects extracted from the code
        
    Raises:
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """
    module = cst.parse_module(source_code)
    
    mapping_collector = _PortMapCollector()
    module.visit(mapping_collector)
    
    return mapping_collector.mappings


@dataclass(slots=True)
class _HolonFunctionCollector(cst.CSTVisitor):
    nodes: list[Node]

    def __init__(self) -> None:
        self.nodes = []

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        kind = _extract_holon_kind(node)
        if kind is None:
            return None

        # Skip workflow functions - deprecated, file itself is the workflow
        # But keep @links functions as metadata nodes so UI knows where to inject edges
        if kind == "workflow":
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
class _NodeClassCollector(cst.CSTVisitor):
    """Collect nodes defined as @node decorated classes."""

    nodes: list[Node]

    def __init__(self) -> None:
        self.nodes = []

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        """Extract @node(type=..., id=...) class definitions."""
        # Check if class has @node decorator
        node_decorator = None
        for dec in node.decorators:
            if _decorator_matches(dec.decorator, "node"):
                node_decorator = dec.decorator
                break
        
        if node_decorator is None:
            return None
        
        # Extract type and id from decorator arguments
        if not isinstance(node_decorator, cst.Call):
            return None
        
        node_type: str | None = None
        node_id: str | None = None
        
        for arg in node_decorator.args:
            if arg.keyword is None:
                continue
            k = arg.keyword.value
            if k == "type":
                node_type = _string_expr_value(arg.value)
            if k == "id":
                node_id = _string_expr_value(arg.value)
        
        if node_id is None or node_type is None:
            return None
        
        # Extract class attributes as props
        props = self._extract_class_props(node)
        
        # Extract label from docstring
        label: str | None = None
        for stmt in node.body.body:
            if isinstance(stmt, cst.SimpleStatementLine) and len(stmt.body) == 1:
                inner = stmt.body[0]
                if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.SimpleString):
                    # First string is docstring
                    label = _string_expr_value(inner.value)
                    break
        
        self.nodes.append(
            Node(
                id=node_id,
                name=node.name.value,
                kind="spec",
                node_type=node_type,
                label=label,
                props=props or None,
                position=None,
            )
        )
        return None
    
    def _extract_class_props(self, node: cst.ClassDef) -> dict[str, object] | None:
        """Extract class-level attributes as props dictionary."""
        props: dict[str, object] = {}
        
        for stmt in node.body.body:
            if not isinstance(stmt, cst.SimpleStatementLine):
                continue
            if len(stmt.body) != 1:
                continue
            
            inner = stmt.body[0]
            
            # Skip docstrings
            if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.SimpleString):
                continue
            
            # Handle simple assignment: x = value
            if isinstance(inner, cst.Assign):
                if len(inner.targets) != 1:
                    continue
                target = inner.targets[0].target
                if not isinstance(target, cst.Name):
                    continue
                
                key = target.value
                value = _jsonish_expr_value(inner.value)
                if value is not None:
                    props[key] = value
            
            # Handle annotated assignment: x: type = value
            elif isinstance(inner, cst.AnnAssign):
                if not isinstance(inner.target, cst.Name):
                    continue
                if inner.value is None:
                    continue
                
                key = inner.target.value
                value = _jsonish_expr_value(inner.value)
                if value is not None:
                    props[key] = value
        
        return props if props else None


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
    if any(_decorator_matches(d, "links") for d in decorators):
        return "links"
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


def _jsonish_expr_value(expr: cst.BaseExpression) -> object | None:
    """Extract a JSON-compatible value from an expression, or None if not JSON-compatible."""
    result = _jsonish_value(expr)
    return None if result is _NOT_JSONISH else result


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


@dataclass(slots=True)
class _PortMapCollector(cst.CSTVisitor):
    """Collect @port_map declarations from workflow functions."""
    
    mappings: list[PortMapping]
    _workflow_stack: list[str]
    
    def __init__(self) -> None:
        self.mappings = []
        self._workflow_stack = []
    
    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool | None:
        """Track workflow function context."""
        if self._workflow_stack:
            return False
        
        kind = _extract_holon_kind(node)
        if kind != "workflow":
            return True
        
        self._workflow_stack.append(node.name.value)
        return True
    
    def leave_FunctionDef(self, original_node: cst.FunctionDef) -> None:
        """Exit workflow function context."""
        if self._workflow_stack and self._workflow_stack[-1] == original_node.name.value:
            self._workflow_stack.pop()
    
    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        """Look for classes decorated with @port_map."""
        if not self._workflow_stack:
            return None
        
        # Check if this class has @port_map decorator
        if not any(_decorator_matches(d.decorator, "port_map") for d in node.decorators):
            return None
        
        # Extract class attributes: source, target, transform, target_field, when, on_error
        attrs = self._extract_class_attributes(node)
        
        if "source" not in attrs or "target" not in attrs:
            return None  # Invalid mapping, skip
        
        # Parse source and target tuples
        source = attrs.get("source")
        target = attrs.get("target")
        
        if not isinstance(source, tuple) or len(source) != 2:
            return None
        if not isinstance(target, tuple) or len(target) != 2:
            return None
        
        source_node, source_port = source
        target_node, target_port = target
        
        # Create PortMapping
        mapping = PortMapping(
            source_node=str(source_node),
            source_port=str(source_port),
            target_node=str(target_node),
            target_port=str(target_port),
            transform=attrs.get("transform"),
            target_field=attrs.get("target_field"),
            when=attrs.get("when"),
            on_error=attrs.get("on_error", "stop")
        )
        
        self.mappings.append(mapping)
        return None
    
    def _extract_class_attributes(self, node: cst.ClassDef) -> dict[str, object]:
        """Extract class-level attributes as a dictionary."""
        attrs: dict[str, object] = {}
        
        for stmt in node.body.body:
            if not isinstance(stmt, cst.SimpleStatementLine):
                continue
            if len(stmt.body) != 1:
                continue
            
            inner = stmt.body[0]
            if not isinstance(inner, cst.AnnAssign) and not isinstance(inner, cst.Assign):
                continue
            
            # Handle both `x = value` and `x: type = value`
            if isinstance(inner, cst.AnnAssign):
                if not isinstance(inner.target, cst.Name):
                    continue
                attr_name = inner.target.value
                attr_value = inner.value
            elif isinstance(inner, cst.Assign):
                if len(inner.targets) != 1:
                    continue
                target = inner.targets[0].target
                if not isinstance(target, cst.Name):
                    continue
                attr_name = target.value
                attr_value = inner.value
            else:
                continue
            
            if attr_value is None:
                continue
            
            # Parse the value
            parsed = self._parse_attribute_value(attr_value)
            if parsed is not None:
                attrs[attr_name] = parsed
        
        return attrs
    
    def _parse_attribute_value(self, expr: cst.BaseExpression) -> object | None:
        """Parse an attribute value (string, tuple, etc.)."""
        # Handle strings
        if isinstance(expr, cst.SimpleString):
            try:
                return expr.evaluated_value
            except Exception:
                return None
        
        # Handle tuples: (NodeRef, "port")
        if isinstance(expr, cst.Tuple):
            elements = []
            for el in expr.elements:
                # First element is typically a Name (node reference)
                if isinstance(el.value, cst.Name):
                    elements.append(el.value.value)
                # Second element is a string (port name)
                elif isinstance(el.value, cst.SimpleString):
                    try:
                        elements.append(el.value.evaluated_value)
                    except Exception:
                        return None
                else:
                    return None
            return tuple(elements) if len(elements) == 2 else None
        
        # Handle Names (for on_error values like "stop")
        if isinstance(expr, cst.Name):
            return expr.value
        
        # Try JSONish for other types
        val = _jsonish_value(expr)
        return None if val is _NOT_JSONISH else val


@dataclass(slots=True)
class _LinkClassCollector(cst.CSTVisitor):
    """Collect explicit port links declared via @link decorated classes."""

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

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        if not self._workflow_stack:
            return None

        # Check if this class has @link decorator
        if not any(_decorator_matches(d.decorator, "link") for d in node.decorators):
            return None

        # Extract source and target from class attributes
        attrs: dict[str, object] = {}
        for stmt in node.body.body:
            if not isinstance(stmt, cst.SimpleStatementLine):
                continue
            if len(stmt.body) != 1:
                continue

            inner = stmt.body[0]
            if not isinstance(inner, (cst.AnnAssign, cst.Assign)):
                continue

            # Handle both `x = value` and `x: type = value`
            if isinstance(inner, cst.AnnAssign):
                if not isinstance(inner.target, cst.Name):
                    continue
                attr_name = inner.target.value
                attr_value = inner.value
            elif isinstance(inner, cst.Assign):
                if len(inner.targets) != 1:
                    continue
                target = inner.targets[0].target
                if not isinstance(target, cst.Name):
                    continue
                attr_name = target.value
                attr_value = inner.value
            else:
                continue

            if attr_value is None:
                continue

            # Parse the value (expecting tuple or string)
            parsed = self._parse_attribute_value(attr_value)
            if parsed is not None:
                attrs[attr_name] = parsed

        source = attrs.get("source")
        target = attrs.get("target")

        if not source or not target:
            return None

        # Source/Target can be string (node_id) or tuple (node_id, port)
        src_id, src_port = self._normalize_endpoint(source)
        tgt_id, tgt_port = self._normalize_endpoint(target)

        if not src_id or not tgt_id:
            return None

        key = (src_id, src_port or "", tgt_id, tgt_port or "")
        if key in self._seen:
            return None
        self._seen.add(key)
        self.edges.append(
            Edge(
                source=src_id,
                target=tgt_id,
                source_port=src_port,
                target_port=tgt_port,
                kind="link",
            )
        )
        return None

    def _parse_attribute_value(self, expr: cst.BaseExpression) -> object | None:
        """Parse an attribute value (string, tuple, etc.)."""
        # Handle strings
        if isinstance(expr, cst.SimpleString):
            try:
                return expr.evaluated_value
            except Exception:
                return None

        # Handle tuples: ("node_id", "port")
        if isinstance(expr, cst.Tuple):
            elements = []
            for el in expr.elements:
                if isinstance(el.value, cst.SimpleString):
                    try:
                        elements.append(el.value.evaluated_value)
                    except Exception:
                        return None
                elif isinstance(el.value, cst.Name):
                    # Handle class name reference
                    elements.append(el.value.value)
                else:
                    return None
            return tuple(elements)

        return None

    def _normalize_endpoint(self, value: object) -> tuple[str | None, str | None]:
        """Normalize endpoint to (node_id, port)."""
        if isinstance(value, str):
            return value, None
        if isinstance(value, tuple) and len(value) == 2:
            node_ref, port = value
            if not isinstance(node_ref, str) or not isinstance(port, str):
                return None, None
            
            # If node_ref doesn't look like an ID, prefix it with node: (for function refs)
            if ":" not in node_ref:
                node_id = f"node:{node_ref}"
            else:
                node_id = node_ref
                
            return node_id, port
        return None, None


@dataclass(slots=True)
class _RShiftLinkCollector(cst.CSTVisitor):
    """Collect port links declared via >> operator syntax.
    
    Detects patterns like:
        TriggerChat.out >> LangchainAgent.input
        ClassRef.output >> AnotherClass.input
    
    This provides a more idiomatic Python syntax compared to @link decorators.
    """

    edges: list[Edge]
    _workflow_stack: list[str]
    _seen: set[tuple[str, str, str, str]]

    def __init__(self) -> None:
        self.edges = []
        self._workflow_stack = []
        self._seen = set()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool | None:
        """Track workflow or links context."""
        if self._workflow_stack:
            return False

        kind = _extract_holon_kind(node)
        if kind not in ("workflow", "links"):
            return True

        self._workflow_stack.append(node.name.value)
        return True

    def leave_FunctionDef(self, original_node: cst.FunctionDef) -> None:
        """Exit workflow context."""
        if self._workflow_stack and self._workflow_stack[-1] == original_node.name.value:
            self._workflow_stack.pop()

    def visit_Expr(self, node: cst.Expr) -> None:
        """Visit expression statements to find >> operations."""
        if not self._workflow_stack:
            return None

        # Check if this is a BinaryOperation with >> (RightShift)
        if not isinstance(node.value, cst.BinaryOperation):
            return None
        
        if not isinstance(node.value.operator, cst.RightShift):
            return None

        # Extract source and target from the >> operation
        link = self._parse_rshift_link(node.value)
        if link is None:
            return None

        key = (link.source, link.source_port or "", link.target, link.target_port or "")
        if key in self._seen:
            return None
        self._seen.add(key)
        self.edges.append(link)
        return None

    def _parse_rshift_link(self, binop: cst.BinaryOperation) -> Edge | None:
        """Parse a >> binary operation into an Edge.
        
        Handles patterns like:
            ClassNameA.port_out >> ClassNameB.port_in
        
        Returns:
            Edge object or None if parsing failed
        """
        # Parse left side (source)
        source = self._parse_port_reference(binop.left)
        if source is None:
            return None
        
        # Parse right side (target) - could be nested >> (chaining)
        target = self._parse_port_reference(binop.right)
        if target is None:
            # Check if right side is another >> (chaining not supported for now)
            return None
        
        source_node, source_port = source
        target_node, target_port = target
        
        return Edge(
            source=source_node,
            target=target_node,
            source_port=source_port,
            target_port=target_port,
            kind="link",
        )

    def _parse_port_reference(self, expr: cst.BaseExpression) -> tuple[str, str] | None:
        """Parse a port reference like ClassName.port_name.
        
        Args:
            expr: Expression to parse
            
        Returns:
            Tuple of (node_id, port_name) or None if invalid
        """
        # Must be an Attribute access: ClassName.port_name
        if not isinstance(expr, cst.Attribute):
            return None
        
        # Get port name (the attribute name)
        if not isinstance(expr.attr, cst.Name):
            return None
        port_name = expr.attr.value
        
        # Get class/node name (the value being accessed)
        if not isinstance(expr.value, cst.Name):
            return None
        class_name = expr.value.value
        
        # The class_name should correspond to a @node decorated class
        # We need to resolve it to a node ID
        # For now, we'll use the class name directly - the validator/resolver
        # will handle matching it to the actual node ID
        
        return (class_name, port_name)


@dataclass(slots=True)
class _UsesBindingCollector(cst.CSTVisitor):
    """Collect dependency bindings declared via .uses() method calls.
    
    Detects patterns like:
        LangchainAgent.uses(llm=LlmModel.output, memory=Memory.output)
    
    This represents resource/dependency injection, not data flow.
    Creates edges with kind="dependency".
    """

    edges: list[Edge]
    _workflow_or_links_stack: list[str]
    _seen: set[tuple[str, str, str, str]]

    def __init__(self) -> None:
        self.edges = []
        self._workflow_or_links_stack = []
        self._seen = set()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool | None:
        """Track workflow or links context."""
        if self._workflow_or_links_stack:
            return False

        kind = _extract_holon_kind(node)
        if kind not in ("workflow", "links"):
            return True

        self._workflow_or_links_stack.append(node.name.value)
        return True

    def leave_FunctionDef(self, original_node: cst.FunctionDef) -> None:
        """Exit workflow/links context."""
        if self._workflow_or_links_stack and self._workflow_or_links_stack[-1] == original_node.name.value:
            self._workflow_or_links_stack.pop()

    def visit_Expr(self, node: cst.Expr) -> None:
        """Visit expression statements to find .uses() calls."""
        if not self._workflow_or_links_stack:
            return None

        # Check if this is a method call
        if not isinstance(node.value, cst.Call):
            return None
        
        # Check if it's a .uses() call
        if not isinstance(node.value.func, cst.Attribute):
            return None
        
        if not isinstance(node.value.func.attr, cst.Name):
            return None
        
        if node.value.func.attr.value != "uses":
            return None
        
        # Extract target node (the object .uses() is called on)
        if not isinstance(node.value.func.value, cst.Name):
            return None
        
        target_class = node.value.func.value.value
        
        # Parse keyword arguments: llm=LlmModel.output
        for arg in node.value.args:
            if arg.keyword is None:
                continue  # Skip positional args
            
            target_port_name = arg.keyword.value
            
            # Parse the value (should be ClassName.port_name)
            source = self._parse_port_reference(arg.value)
            if source is None:
                continue
            
            source_class, source_port = source
            
            # Create edge for this dependency binding
            key = (source_class, source_port, target_class, target_port_name)
            if key in self._seen:
                continue
            self._seen.add(key)
            
            self.edges.append(
                Edge(
                    source=source_class,
                    target=target_class,
                    source_port=source_port,
                    target_port=target_port_name,
                    kind="link",  # Mark as dependency, not data flow
                )
            )

    def _parse_port_reference(self, expr: cst.BaseExpression) -> tuple[str, str] | None:
        """Parse a port reference like ClassName.port_name.
        
        Args:
            expr: Expression to parse
            
        Returns:
            Tuple of (class_name, port_name) or None if invalid
        """
        # Must be an Attribute access: ClassName.port_name
        if not isinstance(expr, cst.Attribute):
            return None
        
        # Get port name (the attribute name)
        if not isinstance(expr.attr, cst.Name):
            return None
        port_name = expr.attr.value
        
        # Get class/node name (the value being accessed)
        if not isinstance(expr.value, cst.Name):
            return None
        class_name = expr.value.value
        
        return (class_name, port_name)

