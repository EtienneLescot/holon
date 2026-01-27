# Holon — Handoff (Compact)

Date: 2026-01-27

Purpose: this is the minimal “restart context” for the next conversation.

## What is a “node” today?

Today, a Holon “node” is **just a Python function** decorated with `@node`.
- There is **no runtime execution engine yet**.
- There are **no typed ports/connectors yet** (inputs/outputs, LLM, memory, tools, parser).
- The UI shows a graph derived from source code (+ workflow calls), plus positions.

Demo file used: `core/examples/demo.holon.py`
- Nodes: `analyze`, `summarize`
- Workflow: `main`

## Done ✅ (End-to-end demo)

- Core graph parsing: `parse_graph` extracts nodes and workflow→node edges.
- Core RPC over stdio JSONL:
  - `parse_source`, `rename_node`, `patch_node`.
- VS Code extension:
  - Webview panel “Holon: Open”.
  - Live parsing on `*.holon.py` edits (debounced).
  - AI patch flow (Copilot LM API) → core patcher → edits applied in editor.
- UI (React Flow):
  - Custom node with “AI” button + prompt modal.
  - `graph.update` replaces state, edges rendered.
  - “Auto layout” (dagre) button.

## Positions: persistence choice ✅ (Option 1)

Positions persist as workspace metadata:
- Stored in `.holon/positions.json` under the workspace root.
- Written on node moves and on “Auto layout”.
- Reloaded on parse and merged into the graph updates.

Note: VS Code webviews require caching `acquireVsCodeApi()` (called once). This is fixed.

## Known gotcha

If `holon.pythonPath` points to a Python without deps, the RPC start may fail (e.g. missing `pydantic`). The extension falls back to `poetry run python`.

---

# Next steps 🔜 (Real nodes + links)

We want “real nodes” with ports/connectors, starting with a **LangChain Agent node**.

## Phase 5.0 — Define the node/port model (shared contract)

Goal: make nodes more than decorated functions, *without* introducing a second "source of truth".

Key decision (aligned with the blueprint):
- **Code is Truth** for the graph topology (nodes + links).
- JSON is allowed **only for UI-only state** (positions/layout), not for the workflow itself.

Minimal shared model (conceptual contract):
- Node has:
  - `id`, `type`, `label`
  - `props` (JSON-serializable config)
- Edge has:
  - `sourceNodeId`, `sourcePort`
  - `targetNodeId`, `targetPort`

Storage:
- Positions: `.holon/positions.json` (UI-only)
- Graph topology: **encoded in the `.holon.py` file** via a tiny DSL (`spec()` + `link()`), parsed by LibCST.

## Phase 5.1 — UI: linking nodes (connectors)

Goal: the user can create links between ports.

Implementation (code-first):
- Add visible handles for ports.
- Implement connect interaction (React Flow `onConnect`).
- On connect, the extension calls core patcher to insert a `link(...)` statement into the target `@workflow`.
- Then re-parse the Python file and update the UI.

## Phase 5.2 — First real node type: LangChain AI Agent

Goal: represent a LangChain Agent node with explicit connectors.

Node: `langchain.agent`
- Properties (`props`):
  - `systemPrompt`
  - `promptTemplate`
  - `temperature?`, `maxTokens?` (optional)
  - `agentType` (e.g. tool-calling)
- Ports:
  - Input: `input` (data)
  - Output: `output` (data)
  - Connector (required): `llm` (to an LLM provider/model node)
  - Connector (optional): `memory` (conversation history)
  - Connector (optional, multi): `tools[]`
  - Connector (optional): `outputParser`

Notes:
- We should not re-invent agent logic: implement this by mapping config to LangChain.
- First milestone is **configuration + wiring** (no full execution engine required yet).

Code encoding (Variant A):
- Spec nodes are declared at module level:
  - `spec("spec:agent:...", type="langchain.agent", label="LangChain Agent", props={...})`
- Links are declared inside a workflow:
  - `link("spec:llm:...", "llm", "spec:agent:...", "llm")`

## Phase 5.3 — Supporting node types (stubs first)

- `llm.model` (provider selection, model name, keys via env/secret later)
- `memory.buffer` (basic chat history)
- `tool.*` (start with a single example tool)
- `parser.json` / `parser.pydantic` (output shaping)

## Phase 5.4 — Execution (later)

When wiring is stable:
- Add a minimal runtime runner (probably in `core/`) that can execute a graph, starting from a workflow entrypoint.

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
