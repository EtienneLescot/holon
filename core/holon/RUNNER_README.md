# Holon Workflow Runner

## Overview

The Holon Workflow Runner provides simple, reliable execution of `.holon.py` workflows. It's designed to be minimal but extensible, with a clean architecture ready for future enhancements.

## Quick Start

### Basic Usage

```python
from holon.runner import WorkflowRunner
import asyncio

async def main():
    runner = WorkflowRunner()
    result = await runner.run_workflow_file("my_workflow.holon.py", "main")
    
    if result.success:
        print(f"Success: {result.output}")
    else:
        print(f"Error: {result.error}")

asyncio.run(main())
```

### Synchronous Wrapper

For simple scripts where you don't want to deal with async/await:

```python
from holon.runner import run_workflow_sync

result = run_workflow_sync("my_workflow.holon.py", "main")
print(result.output if result.success else result.error)
```

### Example Workflow

```python
# my_workflow.holon.py
from holon import node, workflow

@node
def add(x: int, y: int) -> int:
    return x + y

@node
async def format_result(value: int) -> str:
    return f"Result: {value}"

@workflow
async def main() -> str:
    sum_val = add(5, 3)
    formatted = await format_result(sum_val)
    return formatted
```

## API Reference

### `WorkflowRunner`

Main class for executing workflows.

**Constructor:**
```python
runner = WorkflowRunner(context=None)
```
- `context`: Optional `Context` object passed to nodes (default: empty context)

**Methods:**

#### `run_workflow_file(file_path, workflow_name="main", **kwargs)`
Execute a workflow from a `.holon.py` file.

```python
result = await runner.run_workflow_file(
    "examples/my_workflow.holon.py",
    "main",
    input_data="test"  # kwargs passed to workflow
)
```

Returns: `ExecutionResult`

#### `run_workflow(workflow_fn, **kwargs)`
Execute a workflow function directly.

```python
result = await runner.run_workflow(my_workflow_fn, param=value)
```

Returns: `ExecutionResult`

### `ExecutionResult`

Result of a workflow execution.

**Attributes:**
- `output`: The value returned by the workflow (or `None` if error)
- `error`: Exception if execution failed (or `None` if success)
- `success`: Boolean property, `True` if no error

**Example:**
```python
result = await runner.run_workflow_file("workflow.holon.py", "main")

if result.success:
    print(f"Output: {result.output}")
else:
    print(f"Error type: {type(result.error).__name__}")
    print(f"Error message: {result.error}")
```

### `run_workflow_sync(file_path, workflow_name="main", **kwargs)`

Synchronous convenience function.

```python
result = run_workflow_sync("workflow.holon.py", "main")
```

Returns: `ExecutionResult`

## Current Capabilities

✅ **Supported:**
- Sync and async `@node` functions
- Sync and async `@workflow` functions
- Module loading and isolation
- Comprehensive error handling
- Workflow arguments via `**kwargs`

❌ **Not yet supported (future):**
- Spec node resolution (`@node(type="llm.model", ...)`)
- Port-based data flow (`@link` declarations)
- Context passing to nodes
- Parallel execution
- Execution tracing/debugging
- Streaming results

## Architecture

### Design Principles

1. **Simple first**: Execute Python functions in sequence
2. **Extensible**: Architecture supports future features
3. **Separate**: Execution is opt-in, independent of editing/parsing
4. **Type-safe**: Proper typing and error handling throughout

### Error Handling

The runner catches and reports errors gracefully:

- `FileNotFoundError`: Workflow file doesn't exist
- `ValueError`: Invalid file type (not `.holon.py`)
- `AttributeError`: Workflow function not found in module
- `TypeError`: Function not decorated with `@workflow`
- `RuntimeError` (or any): Errors during workflow execution

All errors are wrapped in `ExecutionResult.error` for consistent handling.

### Module Loading

Workflows are loaded as Python modules using `importlib`. Each execution:
1. Loads the module fresh (no caching between runs)
2. Adds to `sys.modules` during execution
3. Cleans up `sys.modules` on failure
4. Maintains isolation from other modules

## Examples

### Running the Demo

```bash
cd core
python examples/run_demo.py
```

Expected output:
```
🚀 Starting Holon Workflow Runner Demo

============================================================
Holon Workflow Runner - Async Demo
============================================================

▶ Executing workflow: simple_exec.holon.py
  Entrypoint: main()

────────────────────────────────────────────────────────────
✓ Success!
  Output: Final result: 16
────────────────────────────────────────────────────────────
```

### Workflow with Arguments

```python
# workflow.holon.py
from holon import node, workflow

@node
def multiply(x: int, factor: int) -> int:
    return x * factor

@workflow
def main(input_value: int) -> int:
    return multiply(input_value, 3)
```

```python
# Execute with arguments
result = await runner.run_workflow_file(
    "workflow.holon.py",
    "main",
    input_value=7
)
print(result.output)  # 21
```

### Error Handling Example

```python
result = await runner.run_workflow_file("nonexistent.holon.py", "main")

if not result.success:
    if isinstance(result.error, FileNotFoundError):
        print("File not found - check the path")
    elif isinstance(result.error, AttributeError):
        print("Workflow function not found in file")
    else:
        print(f"Unexpected error: {result.error}")
```

## Testing

The runner includes comprehensive tests:

```bash
cd core
pytest tests/test_runner.py -v
```

Test coverage includes:
- Basic workflow execution
- Sync and async node mixing
- Error scenarios (missing files, invalid workflows, execution errors)
- Workflow arguments
- Module loading and isolation

## Future Enhancements

### Phase 6 Extended (planned)

1. **Spec Node Resolution**
   - Registry of spec types → factory functions
   - Example: `"llm.model"` + props → instantiate LLM client
   - Integration with langchain, etc.

2. **Port-Based Data Flow**
   - Respect `@link` declarations
   - Explicit port connections
   - Validation of port compatibility

3. **Context Passing**
   - Make `Context` available to all nodes
   - Runtime services (logging, tracing, secrets)

4. **Parallel Execution**
   - Detect independent nodes
   - Run concurrently with proper ordering

5. **Execution Tracing**
   - Collect timing information
   - Store intermediate values
   - Capture full execution history

6. **Streaming Support**
   - Yield intermediate results
   - Long-running workflow progress
   - Real-time updates

## Contributing

When extending the runner:

1. Maintain backward compatibility
2. Add tests for new features
3. Update this README
4. Follow the existing architecture patterns
5. Keep the simple cases simple

## See Also

- [HOLON_NEXT_STEPS.md](../../HOLON_NEXT_STEPS.md) - Project roadmap
- [examples/simple_exec.holon.py](../examples/simple_exec.holon.py) - Simple workflow example
- [examples/run_demo.py](../examples/run_demo.py) - Demo script
- [tests/test_runner.py](../tests/test_runner.py) - Test suite
