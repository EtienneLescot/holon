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
    links_function_name: str,
    source_node_id: str,
    source_port: str,
    target_node_id: str,
    target_port: str,
) -> str:
    """Insert a link using >> operator syntax inside a @links function.

    Args:
        source_code: Original module source code.
        links_function_name: Name of the target @links function.
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
        links_function_name=links_function_name,
        source_node_id=source_node_id,
        source_port=source_port,
        target_node_id=target_node_id,
        target_port=target_port,
    )
    updated = wrapper.visit(transformer)
    return updated.code


def delete_node(source_code: str, *, node_id: str) -> str:
    """Delete a node from code.

    Supported:
    - spec nodes: remove the module-level `spec(node_id, ...)` statement.
    - node functions: remove the `@node` function definition.

    Also removes explicit `link(...)` statements inside workflows where the
    deleted node id appears as either source or target.

    Notes:
    - This does NOT attempt to remove workflow call edges (e.g. `x = analyze(...)`).
    - Workflow nodes are not deleted.
    """

    if not isinstance(node_id, str) or not node_id:
        raise ValueError("node_id must be a non-empty string")

    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _DeleteNodeTransformer(node_id=node_id)
    updated = wrapper.visit(transformer)
    if not transformer.deleted_any:
        raise ValueError(f"node not found: {node_id}")
    return updated.code


def delete_edge(
    source_code: str,
    *,
    source_node_id: str,
    source_port: str | None,
    target_node_id: str,
    target_port: str | None,
) -> str:
    """Delete an edge (link or port_map) from code.

    Removes:
    - Explicit `link(...)` calls inside workflows matching the connection.
    - Classes decorated with `@link` or `@port_map` matching the connection.
    """
    module = cst.parse_module(source_code)
    wrapper = MetadataWrapper(module)
    transformer = _DeleteEdgeTransformer(
        source_node_id=source_node_id,
        source_port=source_port,
        target_node_id=target_node_id,
        target_port=target_port,
    )
    updated = wrapper.visit(transformer)
    if not transformer.deleted_any:
        # It's possible the edge was implied or already gone?
        # But usually we want to know if we failed.
        # For now, let's raise if we didn't find anything.
        raise ValueError("edge not found")
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
        updated_node = _ensure_holon_imports(updated_node, names={"node"})

        # Generate class name from label or type
        if self.label:
            class_name = "".join(word.capitalize() for word in self.label.replace("-", " ").replace("_", " ").replace(".", " ").split())
        else:
            class_name = "".join(word.capitalize() for word in self.node_type.split("."))
        
        # Ensure class name is valid Python identifier (remove any remaining special chars)
        class_name = "".join(c for c in class_name if c.isalnum())
        if not class_name or not class_name[0].isalpha():
            class_name = "Node" + class_name
        
        # Build decorator: @node(type="...", id="...")
        decorator_args: list[cst.Arg] = [
            cst.Arg(keyword=cst.Name("type"), value=cst.SimpleString(json.dumps(self.node_type))),
            cst.Arg(keyword=cst.Name("id"), value=cst.SimpleString(json.dumps(self.node_id))),
        ]
        
        decorator = cst.Decorator(
            decorator=cst.Call(
                func=cst.Name("node"),
                args=decorator_args,
            )
        )
        
        # Build class body with props as class attributes
        class_body_stmts: list[cst.BaseStatement] = []
        
        # Add docstring if label exists
        if self.label:
            class_body_stmts.append(
                cst.SimpleStatementLine(
                    body=[cst.Expr(value=cst.SimpleString(json.dumps(self.label)))]
                )
            )
        
        # Add properties as class attributes
        if self.props:
            for key, value in self.props.items():
                class_body_stmts.append(
                    cst.SimpleStatementLine(
                        body=[
                            cst.Assign(
                                targets=[cst.AssignTarget(target=cst.Name(key))],
                                value=_to_cst_jsonish(value),
                            )
                        ]
                    )
                )
        
        # If no body, add pass statement
        if not class_body_stmts:
            class_body_stmts.append(
                cst.SimpleStatementLine(body=[cst.Pass()])
            )
        
        # Create class definition
        class_def = cst.ClassDef(
            name=cst.Name(class_name),
            body=cst.IndentedBlock(body=class_body_stmts),
            decorators=[decorator],
            leading_lines=[cst.EmptyLine(indent=False, whitespace=cst.SimpleWhitespace(""))],
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

        body.insert(insert_at, class_def)
        return updated_node.with_changes(body=body)


@dataclass(slots=True)
class _AddLinkTransformer(cst.CSTTransformer):
    links_function_name: str
    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str

    def leave_Module(self, original_node: cst.Module, updated_node: cst.Module) -> cst.Module:
        # No need to import anything extra - >> syntax uses Port classes already loaded
        return updated_node

    def leave_FunctionDef(
        self, original_node: cst.FunctionDef, updated_node: cst.FunctionDef
    ) -> cst.FunctionDef:
        if not _is_decorated_as(original_node, "links"):
            return updated_node
        if original_node.name.value != self.links_function_name:
            return updated_node

        if not isinstance(updated_node.body, cst.IndentedBlock):
            return updated_node

        # Extract class names from node IDs like "node:trigger:chat:main" -> "TriggerChat"
        # or use the ID directly if it's already a class name
        source_class = self._extract_class_name_from_id(self.source_node_id)
        target_class = self._extract_class_name_from_id(self.target_node_id)

        # Build comment explaining the link
        comment = cst.EmptyLine(
            indent=True,
            whitespace=cst.SimpleWhitespace("    "),
            comment=cst.Comment(f"# {source_class}.{self.source_port} >> {target_class}.{self.target_port}"),
        )

        # Build the >> operator expression: SourceClass.source_port >> TargetClass.target_port
        link_expr = cst.BinaryOperation(
            left=cst.Attribute(
                value=cst.Name(source_class),
                attr=cst.Name(self.source_port),
            ),
            operator=cst.RightShift(),
            right=cst.Attribute(
                value=cst.Name(target_class),
                attr=cst.Name(self.target_port),
            ),
        )

        link_stmt = cst.SimpleStatementLine(
            body=[cst.Expr(value=link_expr)],
            leading_lines=[comment],
        )

        stmts = list(updated_node.body.body)
        
        # Skip docstring if present
        insert_pos = 0
        if (stmts and isinstance(stmts[0], cst.SimpleStatementLine) 
            and stmts[0].body and isinstance(stmts[0].body[0], cst.Expr)
            and isinstance(stmts[0].body[0].value, (cst.SimpleString, cst.ConcatenatedString))):
            insert_pos = 1
        
        # Insert after any existing edges, before return statement if present
        if stmts and isinstance(stmts[-1], cst.SimpleStatementLine) and stmts[-1].body and isinstance(stmts[-1].body[0], cst.Return):
            stmts.insert(len(stmts) - 1, link_stmt)
        else:
            stmts.append(link_stmt)

        return updated_node.with_changes(body=updated_node.body.with_changes(body=stmts))

    def _extract_class_name_from_id(self, node_id: str) -> str:
        """Extract a class name from a node ID.
        
        Examples:
            "node:trigger:chat:main" -> looks up class name from context or uses "TriggerChat"
            "TriggerChat" -> "TriggerChat"
            "spec:chat:test" -> looks up class name
        
        For now, try to guess based on common patterns.
        TODO: This should ideally look up the actual class name from the graph.
        """
        # If it looks like a class name already (CamelCase), use it
        if node_id and node_id[0].isupper() and ":" not in node_id:
            return node_id
        
        # Otherwise, it's likely a node ID - just return it as-is for now
        # The user will see it in the generated code and can fix it manually
        # In a production system, we'd maintain a mapping from node_id to class_name
        return node_id


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
    
    def leave_ClassDef(self, original_node: cst.ClassDef, updated_node: cst.ClassDef) -> cst.ClassDef:
        """Patch @node decorated classes matching the node_id."""
        if self.patched:
            return updated_node
        
        # Check if class has @node decorator with matching id
        node_decorator_idx = None
        for idx, dec in enumerate(original_node.decorators):
            decorator = dec.decorator
            if not isinstance(decorator, cst.Call):
                continue
            if not _decorator_matches(decorator.func, "node"):
                continue
            
            # Extract id from decorator arguments
            for arg in decorator.args:
                if arg.keyword and arg.keyword.value == "id":
                    id_value = _string_expr_value(arg.value)
                    if id_value == self.node_id:
                        node_decorator_idx = idx
                        break
            if node_decorator_idx is not None:
                break
        
        if node_decorator_idx is None:
            return updated_node
        
        # Extract current props from class body
        current_props: dict[str, Any] = {}
        for stmt in original_node.body.body:
            if not isinstance(stmt, cst.SimpleStatementLine) or len(stmt.body) != 1:
                continue
            inner = stmt.body[0]
            
            # Skip docstrings
            if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.SimpleString):
                continue
            
            # Extract assignments
            if isinstance(inner, cst.Assign) and len(inner.targets) == 1:
                target = inner.targets[0].target
                if isinstance(target, cst.Name):
                    key = target.value
                    value = _from_cst_jsonish(inner.value)
                    if value is not None:
                        current_props[key] = value
            elif isinstance(inner, cst.AnnAssign) and isinstance(inner.target, cst.Name) and inner.value:
                key = inner.target.value
                value = _from_cst_jsonish(inner.value)
                if value is not None:
                    current_props[key] = value
        
        # Merge with new props
        next_props = current_props.copy()
        if self.set_props and self.props is not None:
            next_props.update(self.props)
        
        # Rebuild class body with updated props
        new_body_stmts: list[cst.BaseStatement] = []
        
        # Preserve docstring if exists
        for stmt in original_node.body.body:
            if isinstance(stmt, cst.SimpleStatementLine) and len(stmt.body) == 1:
                inner = stmt.body[0]
                if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.SimpleString):
                    new_body_stmts.append(stmt)
                    break
        
        # Add props as assignments
        for key, value in next_props.items():
            new_body_stmts.append(
                cst.SimpleStatementLine(
                    body=[
                        cst.Assign(
                            targets=[cst.AssignTarget(target=cst.Name(key))],
                            value=_to_cst_jsonish(value),
                        )
                    ]
                )
            )
        
        # If no body, add pass
        if not new_body_stmts:
            new_body_stmts.append(cst.SimpleStatementLine(body=[cst.Pass()]))
        
        # Update decorator if needed (type, label)
        decorators = list(updated_node.decorators)
        if node_decorator_idx is not None:
            old_decorator = decorators[node_decorator_idx].decorator
            if isinstance(old_decorator, cst.Call):
                new_args = list(old_decorator.args)
                
                # Update type if requested
                if self.set_node_type and self.node_type:
                    type_arg_idx = None
                    for idx, arg in enumerate(new_args):
                        if arg.keyword and arg.keyword.value == "type":
                            type_arg_idx = idx
                            break
                    
                    new_type_arg = cst.Arg(
                        keyword=cst.Name("type"),
                        value=cst.SimpleString(json.dumps(self.node_type))
                    )
                    if type_arg_idx is not None:
                        new_args[type_arg_idx] = new_type_arg
                    else:
                        new_args.append(new_type_arg)
                
                new_decorator_call = old_decorator.with_changes(args=new_args)
                decorators[node_decorator_idx] = decorators[node_decorator_idx].with_changes(decorator=new_decorator_call)
        
        self.patched = True
        return updated_node.with_changes(
            body=cst.IndentedBlock(body=new_body_stmts),
            decorators=decorators,
        )


@dataclass(slots=True)
class _DeleteNodeTransformer(cst.CSTTransformer):
    """Delete spec(...) statements, @node functions, and related link(...) statements."""

    node_id: str
    deleted_any: bool = False

    def __post_init__(self) -> None:
        if not self.node_id:
            raise ValueError("node_id must be non-empty")

    @property
    def _node_name(self) -> str | None:
        if self.node_id.startswith("node:"):
            name = self.node_id[len("node:") :]
            return name or None
        return None

    def leave_FunctionDef(self, original_node: cst.FunctionDef, updated_node: cst.FunctionDef) -> cst.RemovalSentinel | cst.FunctionDef:
        node_name = self._node_name
        if node_name and _is_decorated_as(original_node, "node") and original_node.name.value == node_name:
            self.deleted_any = True
            return cst.RemoveFromParent()
        return updated_node
    
    def leave_ClassDef(self, original_node: cst.ClassDef, updated_node: cst.ClassDef) -> cst.RemovalSentinel | cst.ClassDef:
        """Remove @node decorated classes matching the node_id."""
        # Check if class has @node decorator with matching id
        for dec in original_node.decorators:
            decorator = dec.decorator
            if not isinstance(decorator, cst.Call):
                continue
            if not _decorator_matches(decorator.func, "node"):
                continue
            
            # Extract id from decorator arguments
            for arg in decorator.args:
                if arg.keyword is None:
                    continue
                if arg.keyword.value == "id":
                    id_value = _string_expr_value(arg.value)
                    if id_value == self.node_id:
                        self.deleted_any = True
                        return cst.RemoveFromParent()
        
        return updated_node

    def leave_SimpleStatementLine(
        self, original_node: cst.SimpleStatementLine, updated_node: cst.SimpleStatementLine
    ) -> cst.RemovalSentinel | cst.SimpleStatementLine:
        # Remove module-level spec(node_id, ...)
        if _is_spec_statement(original_node, self.node_id):
            self.deleted_any = True
            return cst.RemoveFromParent()

        # Remove link(...) statements referencing the node id.
        if _is_link_statement_referencing(original_node, self.node_id):
            self.deleted_any = True
            return cst.RemoveFromParent()

        return updated_node


def _is_spec_statement(stmt: cst.SimpleStatementLine, node_id: str) -> bool:
    if len(stmt.body) != 1:
        return False

    inner = stmt.body[0]
    call: cst.Call | None = None
    if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.Call):
        call = inner.value
    elif isinstance(inner, cst.Assign) and isinstance(inner.value, cst.Call):
        call = inner.value
    else:
        return False

    if not _call_matches(call.func, "spec"):
        return False
    if not call.args:
        return False
    first = _string_expr_value(call.args[0].value)
    return first == node_id


def _is_link_statement_referencing(stmt: cst.SimpleStatementLine, node_id: str) -> bool:
    if len(stmt.body) != 1:
        return False

    inner = stmt.body[0]
    if not (isinstance(inner, cst.Expr) and isinstance(inner.value, cst.Call)):
        return False
    call = inner.value
    if not _call_matches(call.func, "link"):
        return False
    if len(call.args) < 4:
        return False

    src = _string_expr_value(call.args[0].value)
    tgt = _string_expr_value(call.args[2].value)
    return src == node_id or tgt == node_id


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


@dataclass(slots=True)
class _DeleteEdgeTransformer(cst.CSTTransformer):
    source_node_id: str
    source_port: str | None
    target_node_id: str
    target_port: str | None
    deleted_any: bool = False

    def leave_SimpleStatementLine(
        self, original_node: cst.SimpleStatementLine, updated_node: cst.SimpleStatementLine
    ) -> cst.RemovalSentinel | cst.SimpleStatementLine:
        # Check for link(...)
        if len(updated_node.body) == 1:
            expr = updated_node.body[0]
            if isinstance(expr, cst.Expr) and isinstance(expr.value, cst.Call):
                call = expr.value
                if _call_matches(call.func, "link"):
                    if self._check_link_args(call):
                        self.deleted_any = True
                        return cst.RemoveFromParent()
        return updated_node

    def leave_ClassDef(
        self, original_node: cst.ClassDef, updated_node: cst.ClassDef
    ) -> cst.RemovalSentinel | cst.ClassDef:
        # Check for @link or @port_map
        is_link = False
        for dec in original_node.decorators:
            if _decorator_matches(dec.decorator, "link") or _decorator_matches(dec.decorator, "port_map"):
                is_link = True
                break
        
        if not is_link:
            return updated_node

        # Check attributes in body
        # source = ...
        # target = ...
        src_match = False
        tgt_match = False

        for stmt in original_node.body.body:
            if isinstance(stmt, cst.SimpleStatementLine) and len(stmt.body) == 1:
                assign = stmt.body[0]
                if isinstance(assign, cst.Assign) and len(assign.targets) == 1:
                    target_name = assign.targets[0].target
                    if isinstance(target_name, cst.Name):
                        if target_name.value == "source":
                            if self._matches_endpoint(assign.value, self.source_node_id, self.source_port):
                                src_match = True
                        elif target_name.value == "target":
                            if self._matches_endpoint(assign.value, self.target_node_id, self.target_port):
                                tgt_match = True
        
        if src_match and tgt_match:
            self.deleted_any = True
            return cst.RemoveFromParent()
        
        return updated_node

    def _check_link_args(self, call: cst.Call) -> bool:
        # Helper to get string value
        def get_val(idx: int, name: str) -> str | None:
             # Try positional
             if idx < len(call.args) and call.args[idx].keyword is None:
                 return _string_expr_value(call.args[idx].value)
             # Try keyword
             for arg in call.args:
                 if arg.keyword and arg.keyword.value == name:
                     return _string_expr_value(arg.value)
             return None

        s_id = get_val(0, "source_node_id")
        s_port = get_val(1, "source_port")
        t_id = get_val(2, "target_node_id")
        t_port = get_val(3, "target_port")
        
        # Simple string equality
        if s_id != self.source_node_id: return False
        if s_port != self.source_port: return False
        if t_id != self.target_node_id: return False
        if t_port != self.target_port: return False
        
        return True

    def _matches_endpoint(self, value: cst.BaseExpression, node_id: str, port: str | None) -> bool:
        # Expecting tuple: (Node, "port") or ("node_id", "port")
        if not isinstance(value, cst.Tuple) or len(value.elements) != 2:
            return False
        
        node_expr = value.elements[0].value
        port_expr = value.elements[1].value

        # Check port
        p_val = _string_expr_value(port_expr)
        if p_val != port:
            return False

        # Check node
        # Case 1: String literal
        n_val = _string_expr_value(node_expr)
        if n_val == node_id:
            return True
        
        # Case 2: Class name reference
        if isinstance(node_expr, cst.Name):
            # If node_id is "node:ChatNode" and class is ChatNode, match.
            if node_id.startswith("node:") and node_id[5:] == node_expr.value:
                return True
        
        return False
