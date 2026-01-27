"""Minimal stdio RPC server for Holon (Phase 3).

Protocol:
- JSON per line over stdin/stdout.
- Requests: {"id": number, "method": string, "params"?: object}
- Responses: {"id": number, "result"?: any, "error"?: {"message": string}}

This is intentionally tiny and synchronous; later phases can evolve this into a
proper async RPC layer.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class RpcError:
    message: str


def main() -> None:
    """Run the RPC loop reading stdin and writing stdout."""

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()

        if response.get("result") == "shutdown":
            return


def handle_request(request: Any) -> dict[str, Any]:
    """Handle one RPC request.

    Args:
        request: Parsed JSON object.

    Returns:
        RPC response dict.
    """

    if not isinstance(request, dict):
        return {"id": -1, "error": {"message": "Invalid request"}}

    request_id = request.get("id")
    method = request.get("method")

    if not isinstance(request_id, int) or not isinstance(method, str):
        return {"id": -1, "error": {"message": "Invalid request fields"}}

    if method == "hello":
        return {"id": request_id, "result": "hello from holon-core"}

    if method == "ping":
        return {"id": request_id, "result": "pong"}

    if method == "shutdown":
        return {"id": request_id, "result": "shutdown"}

    return {"id": request_id, "error": {"message": f"Unknown method: {method}"}}


if __name__ == "__main__":
    main()
