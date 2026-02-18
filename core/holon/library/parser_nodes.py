"""Structured output parser resolver — Phase 7.0.

Registers:
- ``parser.structured``  constrains LLM output to a JSON schema
"""

from __future__ import annotations

import sys
from typing import Any

from holon.registry import register_spec_type


@register_spec_type("parser.structured")
def resolve_structured_parser(props: dict[str, Any]) -> Any:
    """Resolve a parser.structured spec node.

    Converts a JSON Schema into a LangChain ``PydanticOutputParser`` backed
    by a dynamically generated Pydantic v2 model.  The parser is meant to be
    injected into a ``langchain.agent`` via ``.uses(parser=...)``.

    Props:
        json_schema (dict): JSON Schema object (type=object with properties).
        auto_fix (bool): Whether to append auto-fix instructions when the
            LLM returns invalid JSON.  Default ``True``.

    Returns:
        A LangChain output parser instance that exposes:
        - ``get_format_instructions() -> str``
        - ``parse(text: str) -> dict``
    """
    json_schema = props.get("json_schema", {})
    auto_fix = props.get("auto_fix", True)

    sys.stderr.write(
        f"[PARSER] Building structured output parser "
        f"(schema keys: {list(json_schema.get('properties', {}).keys())})\n"
    )
    sys.stderr.flush()

    try:
        from langchain_core.output_parsers import JsonOutputParser
    except ImportError as exc:
        raise ImportError(
            "langchain-core is required for parser.structured. "
            "Install with: pip install langchain-core"
        ) from exc

    # Build a Pydantic v2 model dynamically from the JSON Schema so that
    # LangChain can generate human-readable format instructions.
    pydantic_model = _json_schema_to_pydantic(json_schema)

    if pydantic_model is not None:
        try:
            from langchain_core.output_parsers import PydanticOutputParser
            parser = PydanticOutputParser(pydantic_object=pydantic_model)
            sys.stderr.write("[PARSER] Using PydanticOutputParser\n")
            sys.stderr.flush()
            return _ParserWrapper(parser, auto_fix=auto_fix)
        except Exception as e:
            sys.stderr.write(f"[PARSER] PydanticOutputParser failed ({e}), falling back to JsonOutputParser\n")
            sys.stderr.flush()

    # Fallback: plain JSON parser with schema as description
    parser = JsonOutputParser()
    sys.stderr.write("[PARSER] Using JsonOutputParser (fallback)\n")
    sys.stderr.flush()
    return _ParserWrapper(parser, auto_fix=auto_fix, schema=json_schema)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

class _ParserWrapper:
    """Thin wrapper that normalises the parser API used by the engine."""

    def __init__(self, inner: Any, *, auto_fix: bool = True, schema: dict | None = None) -> None:
        self._inner = inner
        self._auto_fix = auto_fix
        self._schema = schema

    def get_format_instructions(self) -> str:
        instructions = self._inner.get_format_instructions()
        if self._schema and not hasattr(self._inner, "pydantic_object"):
            import json
            instructions += f"\n\nExpected JSON schema:\n```json\n{json.dumps(self._schema, indent=2)}\n```"
        if self._auto_fix:
            instructions += (
                "\n\nIMPORTANT: Your response MUST be valid JSON. "
                "If you cannot provide a valid JSON response, return an empty object {}."
            )
        return instructions

    def parse(self, text: str) -> Any:
        try:
            return self._inner.parse(text)
        except Exception:
            if self._auto_fix:
                # Try to extract JSON from the response manually
                import re, json
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    try:
                        return json.loads(match.group(0))
                    except Exception:
                        pass
            raise

    def __repr__(self) -> str:
        return f"_ParserWrapper({self._inner!r})"


def _json_schema_to_pydantic(schema: dict) -> Any | None:
    """Attempt to create a Pydantic v2 model from a JSON Schema dict.

    Returns ``None`` if conversion fails (caller falls back to JsonOutputParser).
    """
    if not schema or schema.get("type") != "object":
        return None

    properties = schema.get("properties", {})
    if not properties:
        return None

    try:
        from pydantic import create_model
        from pydantic.fields import FieldInfo
        import typing

        _TYPE_MAP = {
            "string": str,
            "boolean": bool,
            "integer": int,
            "number": float,
            "array": list,
            "object": dict,
        }

        field_definitions: dict[str, Any] = {}
        required_fields = set(schema.get("required", []))

        for field_name, field_schema in properties.items():
            py_type = _TYPE_MAP.get(field_schema.get("type", "string"), str)
            description = field_schema.get("description", "")

            if field_name in required_fields:
                field_definitions[field_name] = (py_type, FieldInfo(description=description))
            else:
                field_definitions[field_name] = (
                    typing.Optional[py_type],
                    FieldInfo(default=None, description=description),
                )

        model = create_model("DynamicSchema", **field_definitions)
        return model

    except Exception as e:
        sys.stderr.write(f"[PARSER] Cannot build Pydantic model from schema: {e}\n")
        sys.stderr.flush()
        return None
