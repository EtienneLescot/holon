# Holon — Status & Next Steps

Date: 2026-01-29 (Updated)

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
- RPC over stdio JSONL: `parse_source`, `rename_node`, `patch_node`, `add_spec_node`, `add_link`, `patch_spec_node`, `execute_workflow`.
- Pydantic validation for RPC params with clear error messages.
- **Workflow execution (Phase 6)**:
  - `WorkflowRunner` class for executing `.holon.py` workflows
  - Support for sync and async @node functions
  - Proper error handling with `ExecutionResult`
  - Module loading and isolation
  - **Spec node resolution**: automatic resolution of spec nodes at runtime
  - **Registry system**: `SpecTypeRegistry` with resolver functions
  - **Built-in resolvers**: llm.model, memory.buffer, tool.function
  - **LangChain integration**: langchain.agent, langchain.memory.buffer, langchain.tool
  - Comprehensive test coverage (51 tests total: 29 runner + 16 registry + 6 spec resolution)
- **CLI commands**:
  - `holon run <file> [--workflow=NAME]` - Execute workflows from command line
  - `holon list <file>` - List workflows, nodes, and spec nodes in a file

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
- **Workflow execution from UI**:
  - RPC method `execute_workflow` integrated
  - TypeScript `executeWorkflow()` method in RPC client
  - Message handling for `ui.workflow.run` and `execution.output`

UI (React):
- Node cards show badges (freeform strings) + summary.
- Buttons: "AI" (edit) + "Describe".
- **Execution features**:
  - "Run Workflow" button for workflow nodes
  - "Output" tab (replaces "Raw Source") displays execution results
  - Formatted JSON output with syntax highlighting
  - Error display in output tab
  - State management for execution results
- **Build system**: Fixed Vite/Rollup configuration for production builds

## Known limitations / pitfalls

- Browser dev mode cannot call Copilot (`vscode.lm`). The intended fallback is to generate a ready-to-copy "AI prompt" (built from the user instruction + node context) so you can run it in your own agent and apply the resulting surgical patch manually.
- Ports are still a UI contract (not enforced/executed at runtime).
- `patch_spec_node` is conservative: it patches module-level `spec(node_id, ...)` calls only.
- **Execution**: Spec nodes are resolved at runtime but port-based data flow is not yet implemented.
- **UI Build**: BrowserBridge only loads in DEV mode (not needed for VS Code extension, only for standalone browser mode).
- **Output granularity**: Execution currently shows final workflow output only, not per-node intermediate results.
- **No streaming**: Execution results only appear after workflow completes.

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

### 3) Formalize the shared contract (ports + node types) 🔄 (IN PROGRESS)
- ✅ Port inference logic centralized in `ui/src/ports.ts`
- ✅ Minimal registry of known spec types (llm.model, memory.buffer, tool.example, parser.json, langchain.agent)
- ⚠️ TypeScript cross-folder imports resolved but with inline copies in browserBridge (technical debt)
- 🔜 Create proper shared package or build pipeline for truly shared code
- 🔜 Runtime port validation

### 4) Phase 6: Basic execution ✅ (DONE)

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
- Extensible: prepared for spec node resolution
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
- ✅ Comprehensive test coverage (51 total: 29 runner + 16 registry + 6 spec resolution)
- ✅ Documentation and examples (REGISTRY_README.md)
- ✅ CLI commands (`holon run`, `holon list`)
- ✅ UI workflow execution with "Run Workflow" button
- ✅ Output tab in UI for viewing execution results
- ✅ RPC integration for extension → Python execution
- ✅ Vite/Rollup build configuration fixed

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

**Files created/modified:**
- `core/holon/registry.py` - Registry implementation (280+ lines)
- `core/holon/library/langchain_registry.py` - LangChain resolvers (210+ lines)
- `core/holon/cli.py` - CLI interface (178 lines)
- `core/holon/__version__.py` - Version info
- `core/holon/rpc/server.py` - Added execute_workflow RPC method
- `core/tests/test_registry.py` - Registry tests (16 tests)
- `core/tests/test_runner.py` - Added spec resolution tests (6 tests)
- `core/examples/spec_nodes.holon.py` - Example workflow
- `core/examples/run_spec_demo.py` - Interactive demo
- `core/examples/multi_agent.holon.py` - Advanced multi-agent example
- `core/holon/REGISTRY_README.md` - Complete documentation (432 lines)
- `extension/src/webview.ts` - Added onUiWorkflowRun handler
- `extension/src/rpcClient.ts` - Added executeWorkflow method
- `extension/tsconfig.json` - Fixed to allow ../ui imports
- `ui/src/App.tsx` - Added execution state and handlers
- `ui/src/ConfigPanel.tsx` - Added Run button and Output tab
- `ui/src/protocol.ts` - Added execution message schemas
- `ui/src/main.tsx` - Fixed browserBridge conditional loading
- `ui/vite.config.ts` - Fixed resolve configuration for build

**Testing:**
```bash
# CLI execution
python -m holon.cli run examples/demo.holon.py
# Output: ✓ Success! Output: result=2

# List workflows
python -m holon.cli list examples/demo.holon.py
# Shows: Workflows, Nodes, Spec Nodes with types
```

### 6) Phase 6: Port-based execution (NEXT HIGH PRIORITY) 🎯

**To implement:**
- Port-based data flow: respect `@link` declarations for explicit connections
- Runtime port validation: ensure type compatibility
- Multi-port connections: support nodes with multiple inputs/outputs
- Port metadata: labels, kinds (data/llm/memory/tool), multiplicity
- Execution graph builder: construct execution order from port links

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

@workflow
async def main():
    # Link LLM output to Agent llm input port
    link(source=(LLM, "llm"), target=(Agent, "llm"))
    
    # Port connections are resolved automatically
    result = Agent(input="Hello")
    return result
```

### 7) Enhanced UI execution features 🔜

**To implement:**
- **Per-node outputs**: Display intermediate results for each node in workflow
- **Real-time updates**: Stream execution progress and outputs as they happen
- **Execution history**: Store and display previous execution results
- **Input parameters**: Allow users to specify workflow inputs from UI
- **Execution state visualization**: Highlight currently executing nodes
- **Error visualization**: Show errors on the node that failed
- **Execution timeline**: Show execution order and timing information

**UI improvements:**
- Progress bar during execution
- Cancel/stop execution button
- Per-node output inspection (click node to see its output)
- Execution mode selector (sequential, parallel when available)
- Input form for workflow parameters

### 8) Phase 6: Advanced execution features (FUTURE)

**To implement:**
- Context passing: make `Context` available to nodes at runtime
- Parallel execution: run independent nodes concurrently
- Execution tracing: collect timing, intermediate values, errors
- Streaming support: yield intermediate results for long-running workflows
- Execution visualization: real-time graph updates showing active nodes
- Checkpointing: save and resume execution state
- Debugging: step-through execution, breakpoints

**Additional features:**
- Workflow composition: call workflows from other workflows
- Conditional execution: if/else logic in workflows
- Loop support: iterate over collections
- Error recovery: retry logic, fallbacks
- Resource management: connection pooling, cleanup

## Implementation notes (2026-01-29 - Updated)

**Steps 1-2 completion:**
- The AI patch reliability improvements are complete with both server-side and client-side validation.
- The "Describe" feature is now production-ready with:
  - Clear badge style guidelines in prompts
  - Batch refresh command with VS Code progress notifications
  - Proper error handling and user feedback

**Steps 4-5 completion (Workflow execution - COMPLETE):**
- ✅ Solid foundation for workflow execution established
- ✅ Spec node resolution fully implemented with registry system
- ✅ 51 tests passing (29 runner + 16 registry + 6 spec resolution)
- ✅ CLI commands functional (`holon run`, `holon list`)
- ✅ LangChain integration working (agent, memory, tools)
- ✅ UI execution features complete:
  - "Run Workflow" button integrated
  - "Output" tab displays execution results
  - RPC communication extension ↔ Python working
  - Error handling and display working
- ✅ Build system fixed (Vite/Rollup configuration resolved)

**Example workflows:**
- `core/examples/demo.holon.py` - Basic workflow with spec nodes
- `core/examples/spec_nodes.holon.py` - Demonstrates spec node types
- `core/examples/multi_agent.holon.py` - Complex multi-agent workflow with LangChain
- `core/examples/run_spec_demo.py` - Interactive demo script
- `core/examples/run_multi_agent.py` - Multi-agent runner

**CLI Demo output:**
```bash
$ python -m holon.cli run examples/demo.holon.py

▶ Executing: examples/demo.holon.py
  Workflow: main
──────────────────────────────────────────────────────────────────────
✓ Success!
Output: result=2
──────────────────────────────────────────────────────────────────────
```

**UI Demo:**
1. Open `.holon.py` file in VS Code
2. Click Holon icon to open graph view
3. Select workflow node
4. Click "Run Workflow" button
5. Switch to "Output" tab to see results

**Technical achievements:**
- Clean architecture: execution separate from parsing/editing
- Type-safe: proper TypeScript/Python typing throughout
- Extensible: registry system allows custom spec type resolvers
- Tested: comprehensive test coverage with pytest
- Documented: 432-line REGISTRY_README.md with examples

**Known technical debt:**
- TypeScript cross-folder imports use inline copies in browserBridge (workaround for Rollup limitations)
- BrowserBridge only loads in DEV mode (conditional import in main.tsx)
- Port-based execution not yet implemented (Step 6)
- Per-node output display not yet implemented (Step 7)
