# Holon — Handoff / Next Steps (End-to-End Demo)

Date: 2026-01-27

This document is the *handoff plan* to continue development in a new conversation.
Goal: deliver a minimal end-to-end demo where **editing Python code updates nodes live in the React Flow view**, and each node has an **AI button** that opens a prompt modal, generates a **surgical patch prompt**, and sends it via **VS Code Language Model (Copilot) API**.

## Current State (What’s already implemented)

### Monorepo layout
- `core/` (Poetry) — Python package `holon`
- `extension/` (TypeScript strict) — VS Code extension skeleton + webview
- `ui/` (Vite + React + TS strict) — React Flow UI built into `ui/dist`

### Core (Python)
- DSL stubs: `core/holon/dsl.py`
- LibCST parser: `core/holon/services/parser.py` (`parse_functions`, `count_node_decorated_functions`)
- LibCST patcher: `core/holon/services/patcher.py` (`rename_node`, `patch_node`)
- RPC server: `core/holon/rpc/server.py` (stdio JSONL, methods: `ping`, `hello`, `shutdown`)
- Tests: `core/tests/*` pass

### Extension (VS Code)
- Command `Holon: Open`
- Webview loads `ui/dist/index.html` and rewrites assets into `webview.asWebviewUri`
- RPC client:
  - handshake `ping`
  - tries `holon.pythonPath` first, then `core/.venv`, then `poetry run python`
  - logs to OutputChannel “Holon”

### UI (React Flow)
- Receives `graph.init` message and renders nodes
- Sends `ui.ready` on load
- Sends `ui.nodesChanged` on drag stop

## Target Demo (Acceptance Criteria)

1) Open a `*.holon.py` file.
2) Webview shows a graph built from `@node` and `@workflow` in that file.
3) When the user edits the file (add/remove/rename `@node`), the graph updates within ~250–500ms.
4) Dragging nodes updates positions and persists them (at least in-memory; ideally written back to code in a stable way).
5) Clicking “AI” on a node opens a modal, user enters a request.
6) Extension generates a “surgical prompt” (context + constraints), calls the VS Code LM API (`vscode.lm` vendor `copilot`).
7) The result is applied as a patch using LibCST (no formatting loss) and the editor updates.

---

## Minimal Protocol Between UI ↔ Extension (Typed)

### UI → Extension
- `ui.ready`
- `ui.nodesChanged`: `{ id, position }[]`
- `ui.node.aiRequest`: `{ nodeId, instruction }`

### Extension → UI
- `graph.init`: `{ nodes, edges }`
- `graph.update`: `{ nodes, edges }` (same schema; replaces state)
- `graph.error`: `{ error }`
- `ai.status`: `{ nodeId, status, message? }`

Implementation note:
- Keep a shared schema, ideally generated from one source. Short-term: duplicate types with Zod validation in UI and careful TS typing in extension.

---

## Phase 4.1 — Core: Parser should return a Graph (Nodes + Edges)

### What to implement
1) Add `core/holon/services/graph_parser.py` (new) or extend `parser.py`.
   - Exported function:
     - `parse_graph(source_code: str) -> Graph` where `Graph` contains `nodes: list[Node]`, `edges: list[Edge]`.
2) Edge extraction from workflows:
   - Within each `@workflow` function body, detect calls to known nodes.
   - Start simple:
     - handle `await node_fn(...)`
     - handle `node_fn(...)`
     - ignore dynamic call patterns for now
   - For each call, add `Edge(source=workflow_id, target=node_id)`.

### Data model update
- Add `Graph` Pydantic model in `core/holon/domain/models.py`.

### Tests
- Add `core/tests/test_graph_parser.py`.
  - Inputs with 2 nodes + 1 workflow referencing them.
  - Verify nodes and edges extracted.

---

## Phase 4.2 — Core: RPC methods for parsing and patching

### Extend stdio RPC
In `core/holon/rpc/server.py`, implement methods:
- `parse_source`: params `{ source: str }` → result `{ nodes: [...], edges: [...] }`
- `rename_node`: params `{ source: str, old_name: str, new_name: str }` → result `{ source: str }`
- `patch_node`: params `{ source: str, node_name: str, new_function_code: str }` → result `{ source: str }`

Notes:
- Keep responses JSON-serializable.
- Return structured errors: `{ error: { message } }`.
- Maintain strict input validation (Pydantic models or manual checks).

---

## Phase 4.3 — Extension: Live parsing loop (editor → core → UI)

### Watch active document
Implement in extension:
1) When Holon panel opens, bind to:
   - `vscode.window.onDidChangeActiveTextEditor`
   - `vscode.workspace.onDidChangeTextDocument` (debounced)
2) Only handle files matching `**/*.holon.py`.
3) On each change:
   - read document text
   - call RPC `parse_source`
   - send `graph.update` to UI

### Debounce strategy
- Use a per-document timer (250–400ms).
- Cancel previous in-flight parse if new edits arrive (simple approach: increment a version counter and drop out-of-date responses).

### Error surface
- Send `graph.error` to UI
- Log full error + stderr to OutputChannel

---

## Phase 4.4 — UI: Graph rendering + AI button + modal

### Node rendering
- Create a custom React Flow node type `HolonNode` with:
  - label
  - kind badge
  - “AI” button

### Prompt modal
- Minimal modal component:
  - text area
  - submit/cancel
  - shows status (loading/error)

### Message flow
- On AI submit: `postMessage({ type: 'ui.node.aiRequest', nodeId, instruction })`
- On drag stop: keep existing `ui.nodesChanged`

Validation:
- No `any`.
- Zod-validate `window.message` payloads.

---

## Phase 4.5 — Extension: Copilot API call (VS Code LM API)

Use VS Code Language Model API:
- `const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' })`
- `const response = await model.sendRequest(messages, options, token)`

### Minimal prompting strategy (“surgical prompt”)
Inputs:
- Node function source (exact code)
- User instruction
- Constraints:
  - preserve signature
  - do not rename unrelated symbols
  - output *only* the new function code

Output contract:
- AI returns a full replacement function definition.

### Apply patch
1) Extension calls core RPC `patch_node` with `{ source: docText, node_name, new_function_code }`.
2) Apply result into editor using `TextEditorEdit` replacing full document text.
3) Parsing loop triggers a UI refresh.

Failure handling:
- If model unavailable, show actionable error:
  - “No Copilot model available or consent not granted.”

---

## Phase 4.6 — Positions persistence (minimum viable)

Option A (fastest): keep positions in extension memory (Map<nodeId, Position>)
- When sending `graph.update`, merge stored positions into nodes.

Option B (better): store positions in source
- Add decorator argument: `@node(position={"x":...,"y":...})` or comment marker.
- Implement core patcher to update just that metadata.

Recommendation for the demo: **Option A first**, then Option B.

---

## Suggested Implementation Order (1–2 days demo)

1) Core: `parse_graph` + edges + tests
2) Core RPC: `parse_source` method
3) Extension: file change debounce + `graph.update` to UI
4) UI: custom node + AI modal + wire messages
5) Extension: `vscode.lm` call + patch application via core RPC `patch_node`
6) Positions: in-memory persistence

---

## Quick “How to run the demo” (when implemented)

1) Build UI: `cd ui && npm install && npm run build`
2) Build extension: `cd extension && npm install && npm run compile`
3) Run extension: `F5` (Extension Development Host)
4) Open a `*.holon.py` file
5) Run `Holon: Open`

---

## Notes / Known Pitfalls

- Webview resource loading requires `localResourceRoots` to include `ui/dist`.
- Copilot integration should use `vscode.lm` (vendor `copilot`). Handle missing model/consent/quota errors.
- Keep files <200 LOC when possible; split UI components early (`nodes/`, `components/`, `bridge/`).
