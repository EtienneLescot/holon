# Holon VS Code Extension (Phase 3)

Skeleton extension:
- Activates when the workspace contains `**/*.holon.py`.
- Command: `Holon: Open` opens a Webview.
- Webview can call a Python RPC server (JSON lines over stdio).

## Dev

- `npm install`
- `npm run compile`
- Press `F5` in VS Code to run the Extension Development Host.

## Python integration

The extension launches a Holon stdio RPC server.

Startup strategy:
- First tries `holon.pythonPath` (default: `python3`) with `PYTHONPATH=<workspace>/core`.
- If the process exits quickly (missing deps), it falls back to `poetry run python -m holon.rpc.server` executed in `<workspace>/core`.

Tip: you can set `holon.pythonPath` to `poetry` to force using Poetry.
