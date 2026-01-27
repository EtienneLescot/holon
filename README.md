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
