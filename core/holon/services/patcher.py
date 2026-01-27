"""Source patching utilities (Phase 2).

Phase 2 objective (per blueprint):
- Perform surgical updates on user Python code without losing formatting.
- Support renaming a Holon node and updating call sites in workflows.

This module intentionally uses LibCST (lossless CST) instead of the standard
library `ast`.
"""

from __future__ import annotations

from dataclasses import dataclass

import libcst as cst
from libcst.metadata import MetadataWrapper, ParentNodeProvider


def rename_node(source_code: str, *, old_name: str, new_name: str) -> str:
    """Rename a Holon node function and update calls inside workflows.

    Rules (Phase 2 POC):
    - Renames the function definition if it is decorated with ``@node``.
    - Updates direct calls to that node *only inside* ``@workflow`` functions.
      (e.g. ``await analyze()`` -> ``await analyze_v2()``)

    Args:
        source_code: Original module source code.
        old_name: Existing node function name.
        new_name: New node function name.

    Returns:
        Updated source code.

    Raises:
        ValueError: If ``old_name`` equals ``new_name``.
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """

    if old_name == new_name:
        raise ValueError("old_name and new_name must differ")

    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _RenameNodeTransformer(old_name=old_name, new_name=new_name)
    updated = wrapper.visit(transformer)
    return updated.code


def patch_node(source_code: str, *, node_name: str, new_function_code: str) -> str:
    """Replace a node function definition with the provided function code.

    The replacement is performed only if the target function is decorated with
    ``@node`` and has the given ``node_name``.

    The ``new_function_code`` must contain exactly one function definition.

    Args:
        source_code: Original module source code.
        node_name: Name of the node function to replace.
        new_function_code: Full Python code for the new function definition.

    Returns:
        Updated source code.

    Raises:
        ValueError: If ``new_function_code`` does not contain exactly one function.
        libcst.ParserSyntaxError: If either source is not valid Python.
    """

    replacement = _parse_single_function(new_function_code)
    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _PatchNodeTransformer(node_name=node_name, replacement=replacement)
    updated = wrapper.visit(transformer)
    return updated.code


def _parse_single_function(code: str) -> cst.FunctionDef:
    module = cst.parse_module(code)

    functions: list[cst.FunctionDef] = []
    for stmt in module.body:
        if isinstance(stmt, cst.FunctionDef):
            functions.append(stmt)

    if len(functions) != 1:
        raise ValueError("new_function_code must contain exactly one FunctionDef")

    return functions[0]


@dataclass(slots=True)
class _RenameNodeTransformer(cst.CSTTransformer):
    METADATA_DEPENDENCIES = (ParentNodeProvider,)

    old_name: str
    new_name: str

    def __post_init__(self) -> None:
        if not self.old_name or not self.new_name:
            raise ValueError("old_name and new_name must be non-empty")

    def leave_FunctionDef(
        self, original_node: cst.FunctionDef, updated_node: cst.FunctionDef
    ) -> cst.FunctionDef:
        if _is_decorated_as(original_node, "node") and original_node.name.value == self.old_name:
            return updated_node.with_changes(name=cst.Name(self.new_name))
        return updated_node

    def leave_Call(self, original_node: cst.Call, updated_node: cst.Call) -> cst.Call:
        # Only rename call sites while inside a workflow.
        if not _is_within_workflow(self, original_node):
            return updated_node

        # Only handle direct calls: old_name(...)
        if isinstance(original_node.func, cst.Name) and original_node.func.value == self.old_name:
            return updated_node.with_changes(func=cst.Name(self.new_name))

        return updated_node


@dataclass(slots=True)
class _PatchNodeTransformer(cst.CSTTransformer):
    node_name: str
    replacement: cst.FunctionDef

    def leave_FunctionDef(
        self, original_node: cst.FunctionDef, updated_node: cst.FunctionDef
    ) -> cst.FunctionDef:
        if _is_decorated_as(original_node, "node") and original_node.name.value == self.node_name:
            # Keep the original leading lines (comments/blank lines) around the statement,
            # but replace the function definition itself.
            return self.replacement
        return updated_node


def _is_decorated_as(func: cst.FunctionDef, decorator_name: str) -> bool:
    """Return True if a FunctionDef has a matching decorator.

    Supports ``@name``, ``@name(...)``, and attribute access (``@pkg.name``).
    """

    for dec in func.decorators:
        if _decorator_matches(dec.decorator, decorator_name):
            return True
    return False


def _decorator_matches(expr: cst.BaseExpression, decorator_name: str) -> bool:
    target: cst.BaseExpression = expr
    if isinstance(target, cst.Call):
        target = target.func

    if isinstance(target, cst.Name):
        return target.value == decorator_name

    if isinstance(target, cst.Attribute):
        return target.attr.value == decorator_name

    return False


def _is_within_workflow(transformer: cst.CSTTransformer, node: cst.CSTNode) -> bool:
    """Return True if node is inside a ``@workflow`` FunctionDef."""

    current: cst.CSTNode | None = node
    while current is not None:
        parent = transformer.get_metadata(ParentNodeProvider, current, default=None)
        if parent is None:
            return False
        if isinstance(parent, cst.FunctionDef):
            return _is_decorated_as(parent, "workflow")
        current = parent

    return False
