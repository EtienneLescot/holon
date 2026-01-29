"""Holon browser dev server (UI-first without VS Code).

This module provides a tiny HTTP API around the Holon core services so the React
UI can be debugged in a normal browser with Vite hot reload.

Design goals:
- Keep "Code is Truth": the API works on a single Python source string.
- No extra dependencies (stdlib only).
- CORS-friendly for localhost dev.

Endpoints (JSON):
- GET  /api/source
- PUT  /api/source
- POST /api/parse
- POST /api/add_spec_node
- POST /api/add_link
- POST /api/patch_node

Run:
- poetry run python -m holon.devserver --file core/examples/demo.holon.py

Note: This is a dev utility, not a production server.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from holon.services.graph_parser import parse_graph
from holon.services.patcher import (
    add_link,
    add_spec_node,
    delete_node,
    patch_node,
    patch_spec_node,
)
from holon.library.credentials import credentials_manager
from holon.runner import run_workflow_sync


class _State:
    def __init__(self, *, file_path: Path | None) -> None:
        self.file_path = file_path
        self.source: str = ""
        self._last_mtime_ns: int | None = None

    def load(self) -> None:
        if self.file_path is None:
            return
        self.source = self.file_path.read_text(encoding="utf8")
        try:
            self._last_mtime_ns = self.file_path.stat().st_mtime_ns
        except OSError:
            self._last_mtime_ns = None

    def refresh(self) -> None:
        """Reload the backing file if it changed on disk."""

        if self.file_path is None:
            return

        try:
            mtime_ns = self.file_path.stat().st_mtime_ns
        except OSError:
            return

        if self._last_mtime_ns is not None and mtime_ns == self._last_mtime_ns:
            return

        try:
            self.source = self.file_path.read_text(encoding="utf8")
            self._last_mtime_ns = mtime_ns
        except OSError:
            return

    def save(self) -> None:
        if self.file_path is None:
            return
        self.file_path.write_text(self.source, encoding="utf8")
        try:
            self._last_mtime_ns = self.file_path.stat().st_mtime_ns
        except OSError:
            self._last_mtime_ns = None


def main(argv: list[str] | None = None) -> None:
    """Entry point for `python -m holon.devserver`."""

    parser = argparse.ArgumentParser(description="Holon UI browser dev server")
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8787,
        help="Port to bind (default: 8787)",
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="Optional .holon.py file to load/save (default: in-memory)",
    )
    args = parser.parse_args(argv)

    file_path = Path(args.file).resolve() if args.file else None
    if file_path is not None and not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")

    state = _State(file_path=file_path)
    state.load()

    handler = _make_handler(state)
    server = HTTPServer((args.host, args.port), handler)

    sys.stderr.write(f"Holon devserver listening on http://{args.host}:{args.port}\n")
    if file_path is not None:
        sys.stderr.write(f"Using file: {file_path}\n")
    server.serve_forever()


def _make_handler(state: _State) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                parsed = json.loads(raw.decode("utf8"))
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"Invalid JSON: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("Body must be a JSON object")
            return parsed

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/", "/health"}:
                state.refresh()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "file": str(state.file_path) if state.file_path is not None else None,
                        "endpoints": {
                            "source": "/api/source",
                            "parse": "/api/parse",
                            "credentials": "/api/credentials",
                            "add_spec_node": "/api/add_spec_node",
                            "add_link": "/api/add_link",
                            "patch_node": "/api/patch_node",
                            "patch_spec_node": "/api/patch_spec_node",
                            "delete_node": "/api/delete_node",
                            "execute_workflow": "/api/execute_workflow",
                        },
                        "ui_hint": "The UI runs on the Vite dev server (typically http://127.0.0.1:5173/). This devserver is API-only.",
                    },
                )
                return
            if self.path == "/api/source":
                state.refresh()
                self._send_json(
                    200,
                    {
                        "source": state.source,
                        "file": str(state.file_path) if state.file_path is not None else None,
                    },
                )
                return
            if self.path.startswith("/api/credentials"):
                provider = self.path.split("/")[-1] if "/" in self.path else None
                if provider == "credentials":
                    provider = None
                
                if provider:
                    self._send_json(200, credentials_manager.get_credentials(provider))
                else:
                    # In a real app we might not want to send everything back
                    self._send_json(200, credentials_manager._store)
                return
            self._send_json(404, {"error": "not_found"})

        def do_PUT(self) -> None:  # noqa: N802
            if self.path == "/api/source":
                try:
                    state.refresh()
                    body = self._read_json()
                    source = body.get("source")
                    if not isinstance(source, str):
                        raise ValueError("source must be a string")
                    state.source = source
                    state.save()
                    self._send_json(200, {"ok": True})
                except Exception as exc:  # noqa: BLE001
                    self._send_json(400, {"error": str(exc)})
                return
            self._send_json(404, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            try:
                state.refresh()
                body = self._read_json()

                if self.path == "/api/parse":
                    graph = parse_graph(state.source)
                    self._send_json(200, {"graph": graph.model_dump()})
                    return

                if self.path == "/api/credentials":
                    provider = body.get("provider")
                    creds = body.get("credentials")
                    if not isinstance(provider, str) or not isinstance(creds, dict):
                        raise ValueError("provider and credentials are required")
                    credentials_manager.set_credentials(provider, creds)
                    self._send_json(200, {"ok": True})
                    return

                if self.path == "/api/add_spec_node":
                    node_id = body.get("node_id")
                    node_type = body.get("node_type")
                    label = body.get("label")
                    props = body.get("props")
                    if not isinstance(node_id, str) or not isinstance(node_type, str):
                        raise ValueError("node_id and node_type must be strings")
                    if label is not None and not isinstance(label, str):
                        raise ValueError("label must be a string or null")
                    if props is not None and not isinstance(props, dict):
                        raise ValueError("props must be an object or null")

                    state.source = add_spec_node(
                        state.source,
                        node_id=node_id,
                        node_type=node_type,
                        label=label,
                        props=props,
                    )
                    state.save()
                    self._send_json(200, {"source": state.source})
                    return

                if self.path == "/api/add_link":
                    workflow_name = body.get("workflow_name")
                    source_node_id = body.get("source_node_id")
                    source_port = body.get("source_port")
                    target_node_id = body.get("target_node_id")
                    target_port = body.get("target_port")

                    if not all(isinstance(x, str) for x in [workflow_name, source_node_id, source_port, target_node_id, target_port]):
                        raise ValueError("workflow_name/source_node_id/source_port/target_node_id/target_port must be strings")

                    state.source = add_link(
                        state.source,
                        workflow_name=workflow_name,
                        source_node_id=source_node_id,
                        source_port=source_port,
                        target_node_id=target_node_id,
                        target_port=target_port,
                    )
                    state.save()
                    self._send_json(200, {"source": state.source})
                    return

                if self.path == "/api/patch_node":
                    node_name = body.get("node_name")
                    new_function_code = body.get("new_function_code")
                    if not isinstance(node_name, str) or not isinstance(new_function_code, str):
                        raise ValueError("node_name and new_function_code must be strings")
                    state.source = patch_node(
                        state.source,
                        node_name=node_name,
                        new_function_code=new_function_code,
                    )
                    state.save()
                    self._send_json(200, {"source": state.source})
                    return

                if self.path == "/api/patch_spec_node":
                    node_id = body.get("node_id")
                    node_type = body.get("node_type")
                    label = body.get("label")
                    props = body.get("props")
                    set_node_type = body.get("set_node_type", False)
                    set_label = body.get("set_label", False)
                    set_props = body.get("set_props", False)

                    if not isinstance(node_id, str):
                        raise ValueError("node_id must be a string")

                    state.source = patch_spec_node(
                        state.source,
                        node_id=node_id,
                        node_type=node_type,
                        label=label,
                        props=props,
                        set_node_type=set_node_type,
                        set_label=set_label,
                        set_props=set_props,
                    )
                    state.save()
                    self._send_json(200, {"source": state.source})
                    return

                if self.path == "/api/execute_workflow":
                    workflow_name = body.get("workflow_name")
                    if not isinstance(workflow_name, str):
                        workflow_name = "main"

                    if state.file_path is None:
                        raise ValueError("No file backing the devserver; cannot execute workflow")

                    # Run synchronously via helper
                    sys.stderr.write(f"[API] Executing workflow '{workflow_name}' from {state.file_path}\n")
                    sys.stderr.flush()
                    result = run_workflow_sync(str(state.file_path), workflow_name=workflow_name)
                    sys.stderr.write(f"[API] Workflow '{workflow_name}' completed: success={result.success}\n")
                    sys.stderr.flush()
                    if result.success:
                        self._send_json(200, {"output": result.output})
                    else:
                        self._send_json(200, {"output": {"error": str(result.error)}})
                    return

                if self.path == "/api/delete_node":
                    node_id = body.get("node_id")
                    if not isinstance(node_id, str):
                        raise ValueError("node_id must be a string")

                    state.source = delete_node(state.source, node_id=node_id)
                    state.save()
                    self._send_json(200, {"source": state.source})
                    return

                self._send_json(404, {"error": "not_found"})
            except Exception as exc:  # noqa: BLE001
                self._send_json(400, {"error": str(exc)})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            # Keep devserver quiet.
            return

    return Handler


if __name__ == "__main__":
    main()
