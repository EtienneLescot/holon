# Holon — Status & Next Steps

Date: 2026-01-27

This file captures the current state (what is implemented) and the next concrete steps.

## Current model (important)

Holon is explicitly **code-first**:
- Topology + config live in the `*.holon.py` source.
- JSON is used only for UI metadata.

Nodes in the graph can be:
- `node:*` — a Python function decorated with `@node`.
- `spec:*` — a deterministic node declared via `spec(...)` at module level.

Links can be:
- workflow→node (implicit): derived from calls inside `@workflow`.
- port links (explicit): declared via `link(...)` inside a `@workflow`.

## Done ✅ (end-to-end)

Core (Python):
- Parsing via LibCST: `@node`, `@workflow`, module-level `spec(...)`, workflow-level `link(...)`.
- Patching via LibCST:
  - `patch_node(...)` for `node:*`.
  - `patch_spec_node(...)` for `spec:*`.
- RPC over stdio JSONL: `parse_source`, `rename_node`, `patch_node`, `add_spec_node`, `add_link`, `patch_spec_node`.

Extension (VS Code):
- Webview renders `graph.init/update` and live-updates on file edits.
- Persisted positions: `.holon/positions.json`.
- Persisted annotations (UI readability): `.holon/annotations.json`.
- AI-first actions via Copilot (`vscode.lm`):
  - “AI edit” on `node:*` patches only that function.
  - “AI edit” on `spec:*` patches only that `spec(...)` call (JSON patch → RPC patch).
  - “Describe” generates `{summary, badges[]}` for `node:*` and `spec:*`.

UI (React):
- Node cards show badges (freeform strings) + summary.
- Buttons: “AI” (edit) + “Describe”.

## Known limitations / pitfalls

- Browser dev mode cannot call Copilot (`vscode.lm`). The intended fallback is to generate a ready-to-copy “AI prompt” (built from the user instruction + node context) so you can run it in your own agent and apply the resulting surgical patch manually.
- Ports are still a UI contract (not enforced/executed at runtime).
- `patch_spec_node` is conservative: it patches module-level `spec(node_id, ...)` calls only.

## Next steps 🔜 (highest impact)

1) Improve AI patch reliability
- Add stricter JSON contracts for spec patches (e.g. enforce `type` string and validate `props` shape).
- Better error messages when Copilot returns malformed JSON.

2) Make “Describe” more useful
- Include a stable badge style guide (still freeform, but encourage consistency).
- Optionally add a “refresh all descriptions” command.

3) Formalize the shared contract (ports + node types)
- Move the port inference logic to a dedicated shared place (today it’s duplicated between extension and browser bridge).
- Define a minimal registry of known `spec` types and their port shapes.

4) Prep Phase 6 (execution)
- Define a minimal runner contract: given a workflow entrypoint, resolve spec nodes into runtime objects.
- Keep execution opt-in and separate from editing.
