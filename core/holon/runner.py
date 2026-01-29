"""Holon workflow runner (Phase 6).

This module provides an execution engine for Holon workflows with support for:
- Python @node functions (sync and async)
- Spec node resolution (instantiate objects from type + props)
- Clean error handling and reporting

Design principles:
- Start simple: execute Python @node functions in sequence
- Extensible: architecture supports spec node resolution
- Clean separation: execution is opt-in and separate from editing/parsing
- Type-safe: proper typing and error handling

Future extensions:
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
from holon.registry import resolve_spec_node, has_spec_type


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
    """Workflow execution engine with spec node resolution.
    
    This runner executes Python functions decorated with @node and @workflow,
    and can resolve spec nodes (library nodes) to runtime objects.
    
    Example:
        ```python
        runner = WorkflowRunner()
        result = await runner.run_workflow_file("examples/simple.holon.py", "main")
        if result.success:
            print(f"Output: {result.output}")
        else:
            print(f"Error: {result.error}")
        ```
    
    Spec Node Resolution:
        Spec nodes decorated with @node(type="...", ...) are automatically
        resolved to runtime objects using the global type registry:
        
        ```python
        @node(type="llm.model", id="spec:llm:gpt4")
        class GPT4:
            model_name = "gpt-4o"
            temperature = 0.7
        
        # At runtime, GPT4 is resolved to an actual LLM client
        ```
    """
    
    def __init__(self, *, context: Context | None = None, resolve_specs: bool = True):
        """Initialize the workflow runner.
        
        Args:
            context: Optional execution context passed to nodes.
                     If None, a default empty context is created.
            resolve_specs: Whether to resolve spec nodes to runtime objects.
                          If False, spec node classes are returned as-is.
        """
        self.context = context or Context()
        self.resolve_specs = resolve_specs
        self._spec_cache: dict[str, Any] = {}  # Cache resolved spec nodes
    
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
        sys.stderr.write(f"[RUNNER] run_workflow_file: {file_path}, workflow={workflow_name}\n")
        sys.stderr.flush()
        
        if not file_path.exists():
            sys.stderr.write(f"[RUNNER] ERROR: File not found: {file_path}\n")
            sys.stderr.flush()
            return ExecutionResult(
                error=FileNotFoundError(f"Workflow file not found: {file_path}")
            )
        
        if not file_path.suffix == ".py" or not file_path.name.endswith(".holon.py"):
            sys.stderr.write(f"[RUNNER] ERROR: Invalid file extension: {file_path}\n")
            sys.stderr.flush()
            return ExecutionResult(
                error=ValueError(f"File must be a .holon.py file: {file_path}")
            )
        
        try:
            # Load the module dynamically
            sys.stderr.write(f"[RUNNER] Loading module from {file_path}\n")
            sys.stderr.flush()
            module = self._load_module(file_path)
            sys.stderr.write(f"[RUNNER] Module loaded successfully\n")
            sys.stderr.flush()
            
            # Find the workflow function
            sys.stderr.write(f"[RUNNER] Looking for workflow function '{workflow_name}'\n")
            sys.stderr.flush()
            workflow_fn = getattr(module, workflow_name, None)
            if workflow_fn is None:
                sys.stderr.write(f"[RUNNER] ERROR: Workflow '{workflow_name}' not found in module\n")
                sys.stderr.flush()
                return ExecutionResult(
                    error=AttributeError(f"Workflow '{workflow_name}' not found in {file_path}")
                )
            
            # Verify it's a workflow
            metadata = getattr(workflow_fn, "__holon_decorator__", None)
            sys.stderr.write(f"[RUNNER] Workflow metadata: {metadata}\n")
            sys.stderr.flush()
            if metadata is None or metadata.kind != "workflow":
                sys.stderr.write(f"[RUNNER] ERROR: Function '{workflow_name}' is not a valid workflow\n")
                sys.stderr.flush()
                return ExecutionResult(
                    error=TypeError(f"Function '{workflow_name}' is not decorated with @workflow")
                )
            
            # Execute the workflow
            sys.stderr.write(f"[RUNNER] Executing workflow '{workflow_name}'\n")
            sys.stderr.flush()
            return await self.run_workflow(workflow_fn, **kwargs)
        
        except Exception as e:
            sys.stderr.write(f"[RUNNER] Exception during execution: {type(e).__name__}: {e}\n")
            sys.stderr.flush()
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
                sys.stderr.write(f"[RUNNER] Workflow is async, awaiting...\n")
                sys.stderr.flush()
                output = await workflow_fn(**kwargs)
            else:
                sys.stderr.write(f"[RUNNER] Workflow is sync, calling...\n")
                sys.stderr.flush()
                output = workflow_fn(**kwargs)
            
            sys.stderr.write(f"[RUNNER] Workflow completed successfully, output type: {type(output).__name__}\n")
            sys.stderr.flush()
            return ExecutionResult(output=output)
        
        except Exception as e:
            sys.stderr.write(f"[RUNNER] Workflow raised exception: {type(e).__name__}: {e}\n")
            sys.stderr.flush()
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
            
            # Post-process: resolve spec nodes if enabled
            if self.resolve_specs:
                self._resolve_module_specs(module)
        except Exception:
            # Clean up on failure
            sys.modules.pop(module_name, None)
            raise
        
        return module
    
    def _resolve_module_specs(self, module: Any) -> None:
        """Resolve spec nodes in a module to runtime objects.
        
        This scans the module for classes decorated with @node(type="...", ...)
        and replaces them with resolved runtime objects.
        
        Args:
            module: The module to scan and resolve
        """
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            
            attr = getattr(module, attr_name, None)
            if attr is None:
                continue
            
            # Check if this is a spec node (library node)
            metadata = getattr(attr, "__holon_decorator__", None)
            if metadata is None or metadata.kind != "node_library":
                continue
            
            # Extract spec metadata
            spec_type = getattr(attr, "__holon_spec_type__", None)
            spec_id = getattr(attr, "__holon_spec_id__", None)
            
            if spec_type is None:
                continue
            
            # Check if we've already resolved this
            if spec_id and spec_id in self._spec_cache:
                setattr(module, attr_name, self._spec_cache[spec_id])
                continue
            
            # Extract props from class attributes
            props = self._extract_spec_props(attr)
            
            # Resolve to runtime object
            try:
                resolved = resolve_spec_node(spec_type, props)
                
                # Cache if we have an ID
                if spec_id:
                    self._spec_cache[spec_id] = resolved
                
                # Replace the class with the resolved object in the module
                setattr(module, attr_name, resolved)
            except ValueError as e:
                # No resolver available - leave the class as-is
                # This allows partial execution even without all resolvers
                pass
    
    def _extract_spec_props(self, cls: type) -> dict[str, Any]:
        """Extract configuration properties from a spec node class.
        
        Extracts non-private, non-callable class attributes as props.
        
        Args:
            cls: The spec node class
        
        Returns:
            Dictionary of property name → value
        """
        props: dict[str, Any] = {}
        
        for attr_name in dir(cls):
            if attr_name.startswith("_"):
                continue
            if attr_name.startswith("__holon"):
                continue
            
            try:
                attr_value = getattr(cls, attr_name)
                
                # Skip methods and special attributes
                if callable(attr_value):
                    continue
                if isinstance(attr_value, (staticmethod, classmethod, property)):
                    continue
                
                props[attr_name] = attr_value
            except AttributeError:
                continue
        
        return props


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
