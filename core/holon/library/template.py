"""Shared template rendering utility for Holon nodes.

Provides a simple ``{{ data.field.subfield }}`` template engine used by:
- logic.switch  (input_expression evaluation)
- http.request  (URL, headers, query_params, body interpolation)
- code.python   (future: dynamic code templates)

The syntax is intentionally minimal: ``{{ expr }}`` where *expr* is a
dot-notation path resolved against a plain-dict *context*.

For richer transformations (JSONPath, lambdas) the existing
:class:`~holon.execution.mapper.PortMapper` should be used instead.
"""

from __future__ import annotations

import re
from typing import Any


_PLACEHOLDER_RE = re.compile(r"\{\{\s*(.+?)\s*\}\}")


def render_template(template: str, context: dict[str, Any]) -> str:
    """Interpolate ``{{ expr }}`` placeholders in *template* using *context*.

    Supports dot-notation paths::

        render_template("Hello {{ data.name }}!", {"data": {"name": "Alice"}})
        # → "Hello Alice!"

        render_template("{{ data.nested.value }}", {"data": {"nested": {"value": 42}}})
        # → "42"

    If an expression cannot be resolved the placeholder is left unchanged.

    Args:
        template: String with ``{{ ... }}`` placeholders.
        context: Flat or nested dict used for resolution.

    Returns:
        String with resolved placeholders.
    """
    def _replace(match: re.Match) -> str:
        expr = match.group(1).strip()
        value = _resolve_path(expr, context)
        if value is _MISSING:
            return match.group(0)  # keep placeholder unchanged
        return str(value)

    return _PLACEHOLDER_RE.sub(_replace, template)


def evaluate_expression(expression: str, data: Any) -> Any:
    """Evaluate a ``{{ expr }}`` expression and return the *raw* Python value.

    Unlike :func:`render_template`, this function returns the resolved value
    *without* converting it to a string, which is needed by the Switch node
    to compare booleans and numbers correctly.

    If *expression* does not contain ``{{ }}``, it is returned as-is.

    Examples::

        evaluate_expression("{{ data.approved }}", {"approved": False})
        # → False   (bool, not the string "False")

        evaluate_expression("{{ data.count }}", {"count": 7})
        # → 7       (int)

    Args:
        expression: Template expression (may or may not have ``{{ }}``)
        data: Data dict to resolve against (used as ``data`` key in context).

    Returns:
        Resolved Python value, or *expression* string if no placeholder found.
    """
    m = _PLACEHOLDER_RE.match(expression.strip())
    if m:
        expr = m.group(1).strip()
        context = {"data": data} if not isinstance(data, dict) or "data" not in data else data
        # Also allow bare paths like "needs_details" directly against data
        value = _resolve_path(expr, context)
        if value is _MISSING:
            # Try resolving against data directly (without "data." prefix)
            value = _resolve_path(expr, data if isinstance(data, dict) else {})
        return value if value is not _MISSING else expression
    return expression


class _Missing:
    """Sentinel for unresolved paths."""
    def __repr__(self) -> str:
        return "<MISSING>"


_MISSING = _Missing()


def _resolve_path(path: str, context: Any) -> Any:
    """Navigate a dot-notation path through *context*.

    Returns :data:`_MISSING` if any step fails.
    """
    parts = path.split(".")
    current: Any = context
    for part in parts:
        if isinstance(current, dict):
            if part in current:
                current = current[part]
            else:
                return _MISSING
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            return _MISSING
    return current
