# Holon (Monorepo)

"Code is Truth. Visual is Interface. AI is the Worker."

## Structure

- `core/` — Python backend (Poetry). Contains the `holon` package.
- `extension/` — VS Code extension (Phase 3).
- `ui/` — React UI (Phase 4).

## Phase 1 (current)

- DSL stubs: `core/holon/dsl.py`
- LibCST parser foundation: `core/holon/services/parser.py`
- Example: `core/examples/simple_workflow.py`
