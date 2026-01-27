"""Source parser utilities.

Phase 1 scope:
- Parse Python source with LibCST.
- Count functions decorated with ``@node``.

Later phases will extract full graph schemas and support lossless rewrites.
"""

from __future__ import annotations

from dataclasses import dataclass

import libcst as cst

from holon.domain.models import Node


def count_node_decorated_functions(source_code: str) -> int:
    """Count functions decorated with ``@node``.

    The implementation intentionally uses LibCST to preserve formatting and
    comments (lossless parsing).

    Args:
        source_code: Python source code to parse.

    Returns:
        Number of function definitions that have a ``@node`` decorator.

    Raises:
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """

    return sum(1 for n in parse_functions(source_code) if n.kind == "node")


def parse_functions(source_code: str) -> list[Node]:
    """Parse a Python module and extract Holon functions.

    Phase 1 extracts only top-level metadata:
    - function name
    - kind (``node`` or ``workflow``)

    Args:
        source_code: Python source code to parse.

    Returns:
        List of extracted functions as domain `Node` models.

    Raises:
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """

    module = cst.parse_module(source_code)
    visitor = _HolonFunctionCollector()
    module.visit(visitor)
    return visitor.nodes


@dataclass(slots=True)
class _HolonFunctionCollector(cst.CSTVisitor):
    nodes: list[Node]

    def __init__(self) -> None:
        self.nodes = []

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        kind = _extract_holon_kind(node)
        if kind is None:
            return None

        # Phase 1: stable id can be derived from kind + function name.
        # Later phases can add source location, module path, or hashing.
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


def _extract_holon_kind(node: cst.FunctionDef) -> str | None:
    """Extract holon kind from a function definition.

    Args:
        node: Function definition CST node.

    Returns:
        ``"node"`` if decorated as a Holon node, ``"workflow"`` if decorated
        as a workflow, otherwise None.
    """

    decorators = [d.decorator for d in node.decorators]
    if any(_decorator_matches(d, "node") for d in decorators):
        return "node"
    if any(_decorator_matches(d, "workflow") for d in decorators):
        return "workflow"
    return None


def _decorator_matches(expr: cst.BaseExpression, decorator_name: str) -> bool:
    """Return True if expression represents a given decorator.

    Supports:
    - ``@name``
    - ``@name(...)``
    - ``@pkg.name`` / ``@pkg.sub.name`` (attribute access)

    Args:
        expr: Decorator expression from LibCST.
        decorator_name: Decorator to match (e.g. ``"node"``).

    Returns:
        True if this decorator should be treated as the provided name.
    """

    target: cst.BaseExpression = expr
    if isinstance(target, cst.Call):
        target = target.func

    if isinstance(target, cst.Name):
        return target.value == decorator_name

    if isinstance(target, cst.Attribute):
        return _attribute_endswith_name(target, decorator_name)

    return False


def _attribute_endswith_name(attribute: cst.Attribute, suffix: str) -> bool:
    """Check if an attribute chain ends with a given name.

    Example: ``holon.dsl.node`` ends with ``node``.

    Args:
        attribute: Attribute expression.
        suffix: Required final name.

    Returns:
        True if final attribute name matches suffix.
    """

    # If it's ``something.node`` we accept it. We don't validate the full chain
    # in Phase 1.
    return attribute.attr.value == suffix
