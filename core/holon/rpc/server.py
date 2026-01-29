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

from pydantic import BaseModel, ValidationError, field_validator

from holon.services.graph_parser import parse_graph
from holon.services.patcher import add_link as add_link_source
from holon.services.patcher import add_spec_node as add_spec_node_source
from holon.services.patcher import delete_node as delete_node_source
from holon.services.patcher import patch_node as patch_node_source
from holon.services.patcher import patch_spec_node as patch_spec_node_source
from holon.services.patcher import rename_node as rename_node_source


@dataclass(frozen=True, slots=True)
class RpcError:
    message: str


class _ParseSourceParams(BaseModel):
    source: str


class _RenameNodeParams(BaseModel):
    source: str
    old_name: str
    new_name: str


class _PatchNodeParams(BaseModel):
    source: str
    node_name: str
    new_function_code: str


class _AddSpecNodeParams(BaseModel):
    source: str
    node_id: str
    node_type: str
    label: str | None = None
    props: dict[str, Any] | None = None


class _AddLinkParams(BaseModel):
    source: str
    workflow_name: str
    source_node_id: str
    source_port: str
    target_node_id: str
    target_port: str


class _PatchSpecNodeParams(BaseModel):
    source: str
    node_id: str
    node_type: str | None = None
    label: str | None = None
    props: dict[str, Any] | None = None
    set_node_type: bool = False
    set_label: bool = False
    set_props: bool = False

    @field_validator("node_type")
    def _validate_node_type(cls, v, info):
        data = info.data or {}
        if data.get("set_node_type"):
            if not isinstance(v, str) or not v.strip():
                raise ValueError("node_type must be a non-empty string when set_node_type is true")
        return v

    @field_validator("props")
    def _validate_props(cls, v, info):
        data = info.data or {}
        if data.get("set_props"):
            if v is None:
                return v
            if not isinstance(v, dict):
                raise ValueError("props must be an object/dict when set_props is true")
            for k in v.keys():
                if not isinstance(k, str):
                    raise ValueError("props keys must be strings")
        return v


class _DeleteNodeParams(BaseModel):
    source: str
    node_id: str


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

    if method == "parse_source":
        try:
            params = _parse_params(request.get("params"), _ParseSourceParams)
            graph = parse_graph(params.source)
            return {"id": request_id, "result": graph.model_dump()}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "rename_node":
        try:
            params = _parse_params(request.get("params"), _RenameNodeParams)
            updated = rename_node_source(
                params.source,
                old_name=params.old_name,
                new_name=params.new_name,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "patch_node":
        try:
            params = _parse_params(request.get("params"), _PatchNodeParams)
            updated = patch_node_source(
                params.source,
                node_name=params.node_name,
                new_function_code=params.new_function_code,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "add_spec_node":
        try:
            params = _parse_params(request.get("params"), _AddSpecNodeParams)
            updated = add_spec_node_source(
                params.source,
                node_id=params.node_id,
                node_type=params.node_type,
                label=params.label,
                props=params.props,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "add_link":
        try:
            params = _parse_params(request.get("params"), _AddLinkParams)
            updated = add_link_source(
                params.source,
                workflow_name=params.workflow_name,
                source_node_id=params.source_node_id,
                source_port=params.source_port,
                target_node_id=params.target_node_id,
                target_port=params.target_port,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "patch_spec_node":
        try:
            params = _parse_params(request.get("params"), _PatchSpecNodeParams)
            updated = patch_spec_node_source(
                params.source,
                node_id=params.node_id,
                node_type=params.node_type,
                label=params.label,
                props=params.props,
                set_node_type=params.set_node_type,
                set_label=params.set_label,
                set_props=params.set_props,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    if method == "delete_node":
        try:
            params = _parse_params(request.get("params"), _DeleteNodeParams)
            updated = delete_node_source(
                params.source,
                node_id=params.node_id,
            )
            return {"id": request_id, "result": {"source": updated}}
        except Exception as exc:  # noqa: BLE001 - return structured RPC errors
            return {"id": request_id, "error": {"message": _format_error(exc)}}

    return {"id": request_id, "error": {"message": f"Unknown method: {method}"}}


def _parse_params(value: Any, model: type[BaseModel]) -> BaseModel:
    if value is None:
        # Pydantic will produce a helpful error.
        value = {}
    if not isinstance(value, dict):
        raise ValueError("params must be an object")

    try:
        return model.model_validate(value)
    except ValidationError as exc:
        # Keep errors readable for the extension/UI.
        raise ValueError(exc.errors(include_url=False)) from exc


def _format_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message


if __name__ == "__main__":
    main()
