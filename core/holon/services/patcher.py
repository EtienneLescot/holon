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


def patch_spec_node(
    source_code: str,
    *,
    node_id: str,
    node_type: str | None = None,
    label: str | None = None,
    props: dict[str, Any] | None = None,
    set_node_type: bool = False,
    set_label: bool = False,
    set_props: bool = False,
) -> str:
    """Patch an existing `spec(...)` declaration identified by `node_id`.

    This is intentionally conservative: it only edits module-level `spec(...)`
    calls whose first argument equals the provided `node_id`.

    The `set_*` flags allow callers (e.g. RPC) to distinguish "not provided"
    from "explicitly set to None".

    Args:
        source_code: Original module source code.
        node_id: Stable spec node id (first positional arg of `spec(...)`).
        node_type: New type value (used only if `set_node_type` is True).
        label: New label (used only if `set_label` is True).
        props: New props dict (used only if `set_props` is True).
        set_node_type: Whether to update the `type=` keyword.
        set_label: Whether to update the `label=` keyword.
        set_props: Whether to update the `props=` keyword.

    Returns:
        Updated source code.

    Raises:
        ValueError: If no matching `spec(node_id, ...)` call is found.
        libcst.ParserSyntaxError: If the source code is not valid Python.
    """

    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _PatchSpecNodeTransformer(
        node_id=node_id,
        node_type=node_type,
        label=label,
        props=props,
        set_node_type=set_node_type,
        set_label=set_label,
        set_props=set_props,
    )
    updated = wrapper.visit(transformer)
    if not transformer.patched:
        raise ValueError(f"spec node not found: {node_id}")
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


@dataclass(slots=True)
class _PatchSpecNodeTransformer(cst.CSTTransformer):
    node_id: str
    node_type: str | None
    label: str | None
    props: dict[str, Any] | None
    set_node_type: bool
    set_label: bool
    set_props: bool

    patched: bool = False

    def leave_SimpleStatementLine(
        self, original_node: cst.SimpleStatementLine, updated_node: cst.SimpleStatementLine
    ) -> cst.SimpleStatementLine:
        if self.patched:
            return updated_node

        if len(original_node.body) != 1:
            return updated_node

        inner = original_node.body[0]
        call: cst.Call | None = None
        if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.Call):
            call = inner.value
        elif isinstance(inner, cst.Assign) and isinstance(inner.value, cst.Call):
            call = inner.value
        else:
            return updated_node

        if not _call_matches(call.func, "spec"):
            return updated_node

        if not call.args:
            return updated_node

        node_id = _string_expr_value(call.args[0].value)
        if node_id != self.node_id:
            return updated_node

        # Extract current values from the call, then apply updates.
        current = _extract_spec_call_fields(call)
        next_type = current.get("type")
        next_label = current.get("label")
        next_props = current.get("props")

        if self.set_node_type:
            next_type = self.node_type
        if self.set_label:
            next_label = self.label
        if self.set_props:
            next_props = self.props

        if not isinstance(next_type, str) or not next_type:
            raise ValueError("spec(type=...) must be a non-empty string")

        args: list[cst.Arg] = [cst.Arg(value=cst.SimpleString(json.dumps(self.node_id)))]
        args.append(cst.Arg(keyword=cst.Name("type"), value=cst.SimpleString(json.dumps(next_type))))

        if next_label is not None:
            args.append(cst.Arg(keyword=cst.Name("label"), value=cst.SimpleString(json.dumps(next_label))))

        if next_props is not None:
            args.append(cst.Arg(keyword=cst.Name("props"), value=_to_cst_jsonish(next_props)))

        new_call = call.with_changes(args=args)

        # Rewrite the inner statement while preserving the outer SimpleStatementLine.
        if isinstance(inner, cst.Expr):
            new_inner: cst.BaseSmallStatement = inner.with_changes(value=new_call)
        else:
            new_inner = inner.with_changes(value=new_call)

        self.patched = True
        return updated_node.with_changes(body=[new_inner])


def _extract_spec_call_fields(call: cst.Call) -> dict[str, Any]:
    """Best-effort extract of fields from a `spec(...)` call.

    This keeps patching predictable while preserving formatting elsewhere.
    """

    out: dict[str, Any] = {"type": None, "label": None, "props": None}
    for a in call.args[1:]:
        if a.keyword is None:
            continue
        k = a.keyword.value
        if k == "type":
            out["type"] = _string_expr_value(a.value)
        elif k == "label":
            out["label"] = _string_expr_value(a.value)
        elif k == "props":
            # Reuse jsonish conversion from graph_parser style.
            out["props"] = _from_cst_jsonish(a.value)
    return out


def _from_cst_jsonish(expr: cst.BaseExpression) -> Any:
    # Mirror graph_parser's limited JSON-ish support.
    if isinstance(expr, cst.Name) and expr.value == "None":
        return None
    if isinstance(expr, cst.SimpleString):
        try:
            return expr.evaluated_value
        except Exception:
            return None
    if isinstance(expr, cst.Integer):
        return int(expr.value)
    if isinstance(expr, cst.Float):
        return float(expr.value)
    if isinstance(expr, cst.Name):
        if expr.value == "True":
            return True
        if expr.value == "False":
            return False
        if expr.value == "None":
            return None
    if isinstance(expr, cst.List):
        return [_from_cst_jsonish(el.value) for el in expr.elements]
    if isinstance(expr, cst.Dict):
        out: dict[str, Any] = {}
        for el in expr.elements:
            if el is None or el.key is None:
                return None
            k = _string_expr_value(el.key)
            if k is None:
                return None
            out[k] = _from_cst_jsonish(el.value)
        return out
    # Fallback: unsupported structure; treat as absent.
    return None


def _call_matches(expr: cst.BaseExpression, name: str) -> bool:
    target: cst.BaseExpression = expr
    if isinstance(target, cst.Name):
        return target.value == name
    if isinstance(target, cst.Attribute):
        return target.attr.value == name
    return False


def _string_expr_value(expr: cst.BaseExpression) -> str | None:
    if isinstance(expr, cst.SimpleString):
        try:
            return expr.evaluated_value
        except Exception:
            return None
    return None


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
