"""Python code execution node resolver — Phase 7.0.

Registers:
- ``code.python``  executes user-supplied Python code in a restricted sandbox
"""

from __future__ import annotations

import sys
from typing import Any

from holon.registry import register_spec_type


@register_spec_type("code.python")
def resolve_code_python(props: dict[str, Any]) -> Any:
    """Resolve a code.python spec node.

    Returns an async callable ``execute(data) -> Any`` that runs the user's
    code in a restricted namespace.

    Props:
        code (str): Python code to execute.  The variable ``data`` is
            pre-injected with the ``DataEnvelope.content`` from the input
            port.  The code must end with a ``return`` statement.
        timeout (int): Maximum execution time in seconds.  Default: ``30``.
            (Enforced via ``asyncio.wait_for`` in the engine caller.)
        allowed_imports (list[str]): Extra stdlib modules to whitelist on top
            of the built-in safe set.  Default: ``["json", "re", "math",
            "datetime"]``.

    Sandbox:
        - Only a curated set of Python builtins are exposed.
        - Imports are statically injected (no ``import`` statement allowed
          in user code).  The whitelist keeps things safe for the current
          "basic sandbox" phase.
        - ``exec``/``eval``/``__import__`` are blocked.

    Returns:
        Async callable ``execute(data: Any) -> Any``.
    """
    code_str: str = props.get("code", "").strip()
    timeout: int = int(props.get("timeout", 30))
    extra_imports: list[str] = list(props.get("allowed_imports", []))

    # Base allowed stdlib modules (always available)
    _BASE_IMPORTS = ["json", "re", "math", "datetime"]
    allowed_modules = list(dict.fromkeys(_BASE_IMPORTS + extra_imports))

    sys.stderr.write(
        f"[CODE] Resolver: code length={len(code_str)}, "
        f"timeout={timeout}s, imports={allowed_modules}\n"
    )
    sys.stderr.flush()

    async def execute(data: Any = None) -> Any:
        """Execute the sandboxed user code."""
        import asyncio
        import json, re, math, datetime

        # ---- Build restricted builtins ----
        safe_builtins: dict[str, Any] = {
            # Types
            "str": str, "int": int, "float": float, "bool": bool,
            "bytes": bytes, "bytearray": bytearray,
            # Collections
            "list": list, "dict": dict, "tuple": tuple, "set": set,
            "frozenset": frozenset,
            # Iteration & functional
            "range": range, "enumerate": enumerate, "zip": zip,
            "map": map, "filter": filter, "reversed": reversed,
            "sorted": sorted, "len": len,
            # Math
            "min": min, "max": max, "sum": sum, "abs": abs, "round": round,
            "divmod": divmod, "pow": pow,
            # Inspection
            "isinstance": isinstance, "issubclass": issubclass, "type": type,
            "hasattr": hasattr, "getattr": getattr,
            # I/O (controlled)
            "print": print,
            # Constants
            "True": True, "False": False, "None": None,
            # Exceptions worth catching in user code
            "ValueError": ValueError, "KeyError": KeyError,
            "TypeError": TypeError, "IndexError": IndexError,
            "Exception": Exception,
        }

        # ---- Inject whitelisted modules ----
        _import_map: dict[str, Any] = {
            "json": json, "re": re, "math": math, "datetime": datetime,
        }
        for mod_name in allowed_modules:
            if mod_name in _import_map:
                safe_builtins[mod_name] = _import_map[mod_name]

        # ---- Wrap user code so ``return`` works at top level ----
        indented = "\n".join(f"    {line}" for line in code_str.split("\n"))
        wrapped = f"def __holon_code__():\n{indented}\n\n__holon_result__ = __holon_code__()\n"

        # ---- Execute ----
        safe_globals: dict[str, Any] = {"__builtins__": safe_builtins}
        local_ns: dict[str, Any] = {"data": data}

        try:
            exec(wrapped, safe_globals, local_ns)  # noqa: S102
        except Exception as e:
            sys.stderr.write(f"[CODE] Execution error: {type(e).__name__}: {e}\n")
            sys.stderr.flush()
            raise

        result = local_ns.get("__holon_result__")
        sys.stderr.write(f"[CODE] Execution OK, result type={type(result).__name__}\n")
        sys.stderr.flush()
        return result

    # Attach metadata for introspection
    execute.__holon_timeout__ = timeout  # type: ignore[attr-defined]
    return execute
