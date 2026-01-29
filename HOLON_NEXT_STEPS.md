# Holon — Status & Next Steps

Date: 2026-01-29

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
- Pydantic validation for RPC params with clear error messages.
- **Workflow execution (Phase 6 initial)**:
  - `WorkflowRunner` class for executing `.holon.py` workflows
  - Support for sync and async @node functions
  - Proper error handling with `ExecutionResult`
  - Module loading and isolation
  - Comprehensive test coverage (14 tests)

Extension (VS Code):
- Webview renders `graph.init/update` and live-updates on file edits.
- Persisted positions: `.holon/positions.json`.
- Persisted annotations (UI readability): `.holon/annotations.json`.
- AI-first actions via Copilot (`vscode.lm`):
  - "AI edit" on `node:*` patches only that function.
  - "AI edit" on `spec:*` patches only that `spec(...)` call (JSON patch → RPC patch).
  - "Describe" generates `{summary, badges[]}` for `node:*` and `spec:*`.
  - Badge style guide in prompts encourages consistent categories ('kind:', 'risk:', 'perf:').
  - Extension-side validation for spec patches with descriptive errors.
- Commands:
  - `holon.open` — Open Holon webview.
  - `holon.refreshDescriptions` — Refresh descriptions for all nodes with progress indicator.
  - `holon.reloadUi` — Reload webview HTML (dev).

UI (React):
- Node cards show badges (freeform strings) + summary.
- Buttons: "AI" (edit) + "Describe".

## Known limitations / pitfalls

- Browser dev mode cannot call Copilot (`vscode.lm`). The intended fallback is to generate a ready-to-copy "AI prompt" (built from the user instruction + node context) so you can run it in your own agent and apply the resulting surgical patch manually.
- Ports are still a UI contract (not enforced/executed at runtime).
- `patch_spec_node` is conservative: it patches module-level `spec(node_id, ...)` calls only.
- **Execution**: Currently supports only Python @node functions. Spec nodes (@node(type="...")) are not yet resolved at runtime.

## Next steps 🔜 (highest impact)

### 1) Improve AI patch reliability ✅ (DONE)

**Completed (2026-01-29):**
- ✅ Server-side Pydantic validation for `patch_spec_node`: validates `node_type` (non-empty string) and `props` (object with string keys)
- ✅ Extension-side validation in `validateSpecPatch()`: checks for unknown keys, validates types
- ✅ Better error messages with `describeType()` helper

### 2) Make "Describe" more useful ✅ (DONE)

**Completed (2026-01-29):**
- ✅ Badge style guide integrated in Copilot prompts (encourages 'kind:', 'risk:', 'perf:' categories)
- ✅ `refreshAllDescriptions()` method implemented in extension
- ✅ VS Code command `holon.refreshDescriptions` registered with progress indicator
- ✅ User confirmation dialog before batch refresh
- ✅ Success message after completion

### 3) Formalize the shared contract (ports + node types) 🔄
- Move the port inference logic to a dedicated shared place (today it's duplicated between extension and browser bridge).
- Define a minimal registry of known `spec` types and their port shapes.
- Consider TypeScript compilation warnings about shared code imports.

### 4) Phase 6: Basic execution ✅ (DONE - initial implementation)

**Completed (2026-01-29):**
- ✅ `WorkflowRunner` class with clean async API
- ✅ Execute Python @node functions (sync and async)
- ✅ Load and run workflows from `.holon.py` files
- ✅ Comprehensive error handling and reporting
- ✅ Synchronous wrapper (`run_workflow_sync`) for simple use cases
- ✅ Full test coverage (14 unit tests)
- ✅ Example workflow and demo script

**Architecture highlights:**
- Clean separation: execution is opt-in and separate from editing/parsing
- Extensible: prepared for future spec node resolution
- Type-safe: proper typing and error handling
- Simple API: `runner.run_workflow_file(path, name)` → `ExecutionResult`

### 5) Phase 6: Extended execution (DONE - spec node resolution) ✅

**Completed (2026-01-29):**
- ✅ Spec type registry with resolver functions
- ✅ Built-in resolvers for common types (LLM, memory, tools)
- ✅ Automatic spec node resolution in workflows
- ✅ Custom resolver registration via decorator
- ✅ LangChain integration with specific resolvers
- ✅ Prop extraction from class attributes
- ✅ Spec node caching by ID
- ✅ Comprehensive test coverage (20+ tests)
- ✅ Documentation and examples

**Architecture:**
```python
# Define spec node with configuration
@node(type="memory.buffer", id="spec:mem:chat")
class ChatMemory:
    max_messages = 10

# At runtime, resolved to actual MemoryBuffer instance
# runner.run_workflow_file() automatically handles resolution
```

**Key Features:**
- Global registry: `holon.registry.SpecTypeRegistry`
- Registration: `@register_spec_type("my.type")`
- Resolution: `resolve_spec_node(type, props)`
- Built-in types: `llm.model`, `memory.buffer`, `tool.function`
- LangChain types: `langchain.agent`, `langchain.memory.buffer`, `langchain.tool`

**Files created:**
- `core/holon/registry.py` - Registry implementation
- `core/holon/library/langchain_registry.py` - LangChain resolvers
- `core/tests/test_registry.py` - Registry tests (20+ tests)
- `core/examples/spec_nodes.holon.py` - Example workflow
- `core/examples/run_spec_demo.py` - Interactive demo
- `core/holon/REGISTRY_README.md` - Complete documentation

### 6) Phase 6: Port-based execution (NEXT)

**To implement:**
- Port-based data flow: respect `@link` declarations for explicit connections
- Runtime port validation: ensure type compatibility
- Multi-port connections: support nodes with multiple inputs/outputs
- Port metadata: labels, kinds (data/llm/memory/tool), multiplicity

**Port resolution strategy:**
- Parse `@link` declarations from workflows
- Build execution graph with port connections
- Validate port compatibility before execution
- Pass data through ports rather than direct function calls

**Example:**
```python
@node(type="langchain.agent", id="spec:agent:1")
class Agent:
    system_prompt = "..."

@node(type="llm.model", id="spec:llm:1")
class LLM:
    model_name = "gpt-4o"

@link
class _:
    source = (LLM, "llm")
    target = (Agent, "llm")

@workflow
async def main():
    # Port connections are resolved automatically
    result = Agent(input="Hello")
    return result
```

### 7) Phase 6: Advanced execution features (FUTURE)

**To implement:**
- Context passing: make `Context` available to nodes at runtime
- Parallel execution: run independent nodes concurrently
- Execution tracing: collect timing, intermediate values, errors
- Streaming support: yield intermediate results for long-running workflows

**Spec resolution strategy:**
- Create a registry of spec types → factory functions
- Example: `"llm.model"` + `props={model_name="gpt-4"}` → instantiate LLM client
- Use library integrations (langchain, etc.) for common types
- Allow user-defined resolvers for custom types

## Implementation notes (2026-01-29)

**Steps 1-2 completion:**
- The AI patch reliability improvements are complete with both server-side and client-side validation.
- The "Describe" feature is now production-ready with:
  - Clear badge style guidelines in prompts
  - Batch refresh command with VS Code progress notifications
  - Proper error handling and user feedback

**Step 4 (execution) - initial implementation:**
- Simple, solid foundation for workflow execution
- Currently executes Python @node functions in sequence
- Architecture designed for future extensions (spec resolution, parallel execution)
- Fully tested with 14 unit tests covering success and error scenarios
- Example workflow demonstrates basic usage: add → multiply → format

**Demo output:**
```
▶ Executing workflow: simple_exec.holon.py
  Entrypoint: main()
────────────────────────────────────────────────────────────
✓ Success!
  Output: Final result: 16
────────────────────────────────────────────────────────────
```

**Known technical debt:**
- TypeScript compilation shows errors related to cross-folder imports (`ui/src` from `extension/src`). This is a configuration issue that should be addressed when formalizing shared contracts (Step 3).
