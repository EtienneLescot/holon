"""Source patching utilities (Phase 2).

Phase 2 objective (per blueprint):
- Perform surgical updates on user Python code without losing formatting.
- Support renaming a Holon node and updating call sites in workflows.

This module intentionally uses LibCST (lossless CST) instead of the standard
library `ast`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

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


def add_spec_node(
    source_code: str,
    *,
    node_id: str,
    node_type: str,
    label: str | None = None,
    props: dict[str, Any] | None = None,
) -> str:
    """Insert a `spec(...)` declaration at module level.

    The declaration is code-first storage for UI/AI-first node creation.

    Args:
        source_code: Original module source code.
        node_id: Stable id (recommended prefix: ``spec:``).
        node_type: Type identifier (e.g. ``langchain.agent``).
        label: Optional display label.
        props: Optional JSON-serializable config.

    Returns:
        Updated source code.
    """

    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _AddSpecNodeTransformer(
        node_id=node_id,
        node_type=node_type,
        label=label,
        props=props,
    )
    updated = wrapper.visit(transformer)
    return updated.code


def add_link(
    source_code: str,
    *,
    workflow_name: str,
    source_node_id: str,
    source_port: str,
    target_node_id: str,
    target_port: str,
) -> str:
    """Insert a `link(...)` declaration inside a workflow function.

    Args:
        source_code: Original module source code.
        workflow_name: Name of the target @workflow function.
        source_node_id: Source node id.
        source_port: Source port id.
        target_node_id: Target node id.
        target_port: Target port id.

    Returns:
        Updated source code.
    """

    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _AddLinkTransformer(
        workflow_name=workflow_name,
        source_node_id=source_node_id,
        source_port=source_port,
        target_node_id=target_node_id,
        target_port=target_port,
    )
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


def _ensure_holon_imports(module: cst.Module, *, names: set[str]) -> cst.Module:
    """Ensure `from holon import ...` includes the required names.

    This is intentionally conservative: it only edits `from holon import ...`.
    If no such import exists, it inserts one after the last import.
    """

    required = set(names)

    class _ImportEdit(cst.CSTTransformer):
        def __init__(self) -> None:
            self.found = False

        def leave_ImportFrom(self, original_node: cst.ImportFrom, updated_node: cst.ImportFrom) -> cst.ImportFrom:
            if not isinstance(updated_node.module, cst.Name) or updated_node.module.value != "holon":
                return updated_node
            if updated_node.names is None or isinstance(updated_node.names, cst.ImportStar):
                return updated_node

            existing: list[cst.ImportAlias] = list(updated_node.names)
            existing_names = {a.name.value for a in existing if isinstance(a.name, cst.Name)}
            missing = [n for n in sorted(required) if n not in existing_names]
            if not missing:
                self.found = True
                return updated_node

            self.found = True
            return updated_node.with_changes(
                names=[
                    *existing,
                    *[cst.ImportAlias(name=cst.Name(n)) for n in missing],
                ]
            )

    t = _ImportEdit()
    updated = module.visit(t)
    if t.found:
        return updated

    # Insert a new `from holon import ...` after the last import.
    import_stmt = cst.SimpleStatementLine(
        body=[
            cst.ImportFrom(
                module=cst.Name("holon"),
                names=[cst.ImportAlias(name=cst.Name(n)) for n in sorted(required)],
            )
        ]
    )

    body: list[cst.BaseStatement] = list(updated.body)
    insert_at = 0
    for i, stmt in enumerate(body):
        if isinstance(stmt, cst.SimpleStatementLine) and stmt.body and isinstance(
            stmt.body[0], (cst.Import, cst.ImportFrom)
        ):
            insert_at = i + 1
            continue
        if isinstance(stmt, cst.Import) or isinstance(stmt, cst.ImportFrom):
            insert_at = i + 1
            continue
    body.insert(insert_at, import_stmt)
    return updated.with_changes(body=body)


def _to_cst_jsonish(value: Any) -> cst.BaseExpression:
    """Convert JSON-serializable values to LibCST expressions.

    Falls back to a JSON string for unsupported structures.
    """

    if value is None:
        return cst.Name("None")
    if value is True:
        return cst.Name("True")
    if value is False:
        return cst.Name("False")
    if isinstance(value, int):
        return cst.Integer(str(value))
    if isinstance(value, float):
        # Use JSON formatting to keep it stable.
        return cst.Float(json.dumps(value))
    if isinstance(value, str):
        return cst.SimpleString(json.dumps(value))
    if isinstance(value, list):
        return cst.List([cst.Element(_to_cst_jsonish(v)) for v in value])
    if isinstance(value, dict):
        elements: list[cst.DictElement] = []
        for k, v in value.items():
            if not isinstance(k, str):
                # Fallback to JSON string.
                return cst.SimpleString(json.dumps(value, ensure_ascii=False))
            elements.append(
                cst.DictElement(
                    key=cst.SimpleString(json.dumps(k)),
                    value=_to_cst_jsonish(v),
                )
            )
        return cst.Dict(elements)

    return cst.SimpleString(json.dumps(value, ensure_ascii=False))


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


@dataclass(slots=True)
class _AddSpecNodeTransformer(cst.CSTTransformer):
    node_id: str
    node_type: str
    label: str | None
    props: dict[str, Any] | None

    def leave_Module(self, original_node: cst.Module, updated_node: cst.Module) -> cst.Module:
        updated_node = _ensure_holon_imports(updated_node, names={"spec", "link"})

        args: list[cst.Arg] = [cst.Arg(value=cst.SimpleString(json.dumps(self.node_id)))]
        args.append(cst.Arg(keyword=cst.Name("type"), value=cst.SimpleString(json.dumps(self.node_type))))
        if self.label is not None:
            args.append(cst.Arg(keyword=cst.Name("label"), value=cst.SimpleString(json.dumps(self.label))))
        if self.props is not None:
            args.append(cst.Arg(keyword=cst.Name("props"), value=_to_cst_jsonish(self.props)))

        stmt = cst.SimpleStatementLine(
            body=[
                cst.Expr(
                    value=cst.Call(
                        func=cst.Name("spec"),
                        args=args,
                    )
                )
            ]
        )

        body: list[cst.BaseStatement] = list(updated_node.body)

        # Insert after the last import.
        insert_at = 0
        for i, s in enumerate(body):
            if isinstance(s, cst.SimpleStatementLine) and s.body and isinstance(s.body[0], (cst.Import, cst.ImportFrom)):
                insert_at = i + 1
                continue
            if isinstance(s, (cst.Import, cst.ImportFrom)):
                insert_at = i + 1
                continue

        body.insert(insert_at, stmt)
        return updated_node.with_changes(body=body)


@dataclass(slots=True)
class _AddLinkTransformer(cst.CSTTransformer):
    workflow_name: str
    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str

    def leave_Module(self, original_node: cst.Module, updated_node: cst.Module) -> cst.Module:
        return _ensure_holon_imports(updated_node, names={"spec", "link"})

    def leave_FunctionDef(
        self, original_node: cst.FunctionDef, updated_node: cst.FunctionDef
    ) -> cst.FunctionDef:
        if not _is_decorated_as(original_node, "workflow"):
            return updated_node
        if original_node.name.value != self.workflow_name:
            return updated_node

        if not isinstance(updated_node.body, cst.IndentedBlock):
            return updated_node

        link_stmt = cst.SimpleStatementLine(
            body=[
                cst.Expr(
                    value=cst.Call(
                        func=cst.Name("link"),
                        args=[
                            cst.Arg(value=cst.SimpleString(json.dumps(self.source_node_id))),
                            cst.Arg(value=cst.SimpleString(json.dumps(self.source_port))),
                            cst.Arg(value=cst.SimpleString(json.dumps(self.target_node_id))),
                            cst.Arg(value=cst.SimpleString(json.dumps(self.target_port))),
                        ],
                    )
                )
            ]
        )

        stmts = list(updated_node.body.body)
        if stmts and isinstance(stmts[-1], cst.SimpleStatementLine) and stmts[-1].body and isinstance(stmts[-1].body[0], cst.Return):
            stmts.insert(len(stmts) - 1, link_stmt)
        else:
            stmts.append(link_stmt)

        return updated_node.with_changes(body=updated_node.body.with_changes(body=stmts))


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
