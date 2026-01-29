"""Holon workflow runner (Phase 6 - initial implementation).

This module provides a minimal but extensible execution engine for Holon workflows.

Design principles:
- Start simple: execute Python @node functions in sequence
- Prepared for growth: architecture supports future spec node resolution
- Clean separation: execution is opt-in and separate from editing/parsing
- Type-safe: proper typing and error handling

Future extensions (not yet implemented):
- Spec node resolution (instantiate objects from type + props)
- Port-based data flow (explicit connections between nodes)
- Parallel execution for independent nodes
- Streaming/async iteration
- Execution tracing and debugging
"""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from holon.dsl import Context


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    """Result of a workflow execution.
    
    Attributes:
        output: The value returned by the workflow entrypoint
        error: Exception if execution failed, None otherwise
        success: True if execution completed without error
    """
    output: Any = None
    error: Exception | None = None
    
    @property
    def success(self) -> bool:
        return self.error is None


class WorkflowRunner:
    """Simple workflow execution engine.
    
    This runner executes Python functions decorated with @node and @workflow.
    It provides a foundation for future enhancements like spec node resolution
    and port-based data flow.
    
    Example:
        ```python
        runner = WorkflowRunner()
        result = await runner.run_workflow_file("examples/simple.holon.py", "main")
        if result.success:
            print(f"Output: {result.output}")
        else:
            print(f"Error: {result.error}")
        ```
    """
    
    def __init__(self, *, context: Context | None = None):
        """Initialize the workflow runner.
        
        Args:
            context: Optional execution context passed to nodes.
                     If None, a default empty context is created.
        """
        self.context = context or Context()
    
    async def run_workflow_file(
        self,
        file_path: str | Path,
        workflow_name: str = "main",
        **kwargs: Any,
    ) -> ExecutionResult:
        """Execute a workflow from a .holon.py file.
        
        Args:
            file_path: Path to the .holon.py file
            workflow_name: Name of the workflow function to execute
            **kwargs: Arguments to pass to the workflow function
        
        Returns:
            ExecutionResult with output or error
        
        Example:
            ```python
            result = await runner.run_workflow_file(
                "examples/simple.holon.py",
                "main",
                input_data="test"
            )
            ```
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            return ExecutionResult(
                error=FileNotFoundError(f"Workflow file not found: {file_path}")
            )
        
        if not file_path.suffix == ".py" or not file_path.name.endswith(".holon.py"):
            return ExecutionResult(
                error=ValueError(f"File must be a .holon.py file: {file_path}")
            )
        
        try:
            # Load the module dynamically
            module = self._load_module(file_path)
            
            # Find the workflow function
            workflow_fn = getattr(module, workflow_name, None)
            if workflow_fn is None:
                return ExecutionResult(
                    error=AttributeError(f"Workflow '{workflow_name}' not found in {file_path}")
                )
            
            # Verify it's a workflow
            metadata = getattr(workflow_fn, "__holon_decorator__", None)
            if metadata is None or metadata.kind != "workflow":
                return ExecutionResult(
                    error=TypeError(f"Function '{workflow_name}' is not decorated with @workflow")
                )
            
            # Execute the workflow
            return await self.run_workflow(workflow_fn, **kwargs)
        
        except Exception as e:
            return ExecutionResult(error=e)
    
    async def run_workflow(
        self,
        workflow_fn: Callable[..., Any],
        **kwargs: Any,
    ) -> ExecutionResult:
        """Execute a workflow function directly.
        
        Args:
            workflow_fn: The workflow function to execute
            **kwargs: Arguments to pass to the workflow function
        
        Returns:
            ExecutionResult with output or error
        """
        try:
            # Check if workflow is async
            if inspect.iscoroutinefunction(workflow_fn):
                output = await workflow_fn(**kwargs)
            else:
                output = workflow_fn(**kwargs)
            
            return ExecutionResult(output=output)
        
        except Exception as e:
            return ExecutionResult(error=e)
    
    def _load_module(self, file_path: Path) -> Any:
        """Load a Python module from a file path.
        
        Args:
            file_path: Path to the Python file
        
        Returns:
            The loaded module
        
        Raises:
            ImportError: If the module cannot be loaded
        """
        module_name = file_path.stem
        
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load module from {file_path}")
        
        module = importlib.util.module_from_spec(spec)
        
        # Add module to sys.modules before execution
        sys.modules[module_name] = module
        
        try:
            spec.loader.exec_module(module)
        except Exception:
            # Clean up on failure
            sys.modules.pop(module_name, None)
            raise
        
        return module


def run_workflow_sync(
    file_path: str | Path,
    workflow_name: str = "main",
    **kwargs: Any,
) -> ExecutionResult:
    """Synchronous wrapper for running a workflow.
    
    This is a convenience function for simple use cases where you don't
    want to deal with async/await.
    
    Args:
        file_path: Path to the .holon.py file
        workflow_name: Name of the workflow function to execute
        **kwargs: Arguments to pass to the workflow function
    
    Returns:
        ExecutionResult with output or error
    
    Example:
        ```python
        result = run_workflow_sync("examples/simple.holon.py", "main")
        print(result.output if result.success else result.error)
        ```
    """
    runner = WorkflowRunner()
    return asyncio.run(runner.run_workflow_file(file_path, workflow_name, **kwargs))
