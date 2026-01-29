# Holon (Monorepo)

"Code is Truth. Visual is Interface. AI is the Worker."

## Structure

- `core/` — Python backend (Poetry). Contains the `holon` package.
- `extension/` — VS Code extension (Phase 3).
- `ui/` — React UI (Phase 4).

Workspace metadata:
- `.holon/positions.json` — UI-only node positions (per file)
- `.holon/annotations.json` — UI-only node annotations (per file): `{ summary, badges[] }`

## Status (current)

Implemented end-to-end:
- Parse graph from `*.holon.py` (decorated `@node`/`@workflow`, plus `spec(...)` and `link(...)`).
- VS Code webview renders nodes + links (React Flow) and persists positions.
- AI-first editing:
	- `node:*` → patches the function body (Copilot → LibCST patch).
	- `spec:*` → patches the `spec(...)` call (Copilot → JSON patch → LibCST patch).
- “Describe” action generates and displays `summary` + freeform `badges` and persists them.

Not implemented yet:
- Runtime execution engine.
- A typed port system beyond the current UI-level contract.
- Browser dev mode AI (VS Code Copilot only).

## How to run (VS Code extension)

1) Install deps and build:
- `cd ui && npm install && npm run build`
- `cd extension && npm install && npm run compile`

2) Run extension:
- In VS Code: `F5` (Extension Development Host)

3) Open a `*.holon.py` file and run:
- Command: `Holon: Open`

## How to run (browser dev mode)

The browser dev mode is for UI iteration (Vite HMR). AI actions are not supported there.

- `npm run dev:demo`

## Development (recommended)

During development you can run both the Python devserver (API) and the UI dev server (Vite) with one command. The API will auto-restart when Python files under `core/` change and the UI benefits from Vite hot-reload.

- Start everything in one terminal:

```bash
npm run dev
```

What this does:
- `API` (Python devserver) runs under `nodemon` and restarts automatically when files in `core/` change.
- `UI` runs under `vite` with HMR; changes to `ui/src` are applied automatically.
- Both process logs are shown in the same terminal with colored prefixes so you can follow API and UI output together.

If you prefer to run them separately:

- Start API only (auto-restart):
```bash
npm run dev:api-watch
# or directly: .venv/bin/python core/holon/devserver.py --file core/examples/demo.holon.py --port 8787
```

- Start UI only:
```bash
cd ui
npm run dev
```

When building for the VS Code extension (production webview assets), run:

```bash
cd ui && npm run build
```
