"""Tests for the Holon workflow runner.

These tests verify:
- Basic workflow execution (sync and async nodes)
- Error handling (missing files, invalid workflows, execution errors)
- Module loading and isolation
- ExecutionResult contract
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest

# Configure pytest-asyncio
pytest_plugins = ('pytest_asyncio',)

from holon.runner import ExecutionResult, WorkflowRunner, run_workflow_sync


class TestExecutionResult:
    """Test the ExecutionResult dataclass."""
    
    def test_success_result(self):
        result = ExecutionResult(output="test output")
        assert result.success is True
        assert result.output == "test output"
        assert result.error is None
    
    def test_error_result(self):
        error = ValueError("test error")
        result = ExecutionResult(error=error)
        assert result.success is False
        assert result.output is None
        assert result.error is error
    
    def test_output_and_error(self):
        # Edge case: both output and error (error takes precedence)
        error = RuntimeError("oops")
        result = ExecutionResult(output="data", error=error)
        assert result.success is False


class TestWorkflowRunner:
    """Test the WorkflowRunner class."""
    
    @pytest.fixture
    def runner(self):
        return WorkflowRunner()
    
    @pytest.mark.asyncio
    async def test_run_simple_workflow(self, runner, tmp_path):
        # Create a simple workflow file
        workflow_file = tmp_path / "test.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def add(x: int, y: int) -> int:
    return x + y

@workflow
async def main() -> int:
    return add(5, 3)
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is True
        assert result.output == 8
    
    @pytest.mark.asyncio
    async def test_run_sync_and_async_nodes(self, runner, tmp_path):
        workflow_file = tmp_path / "mixed.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def sync_node(x: int) -> int:
    return x * 2

@node
async def async_node(x: int) -> int:
    return x + 10

@workflow
async def main() -> int:
    a = sync_node(5)
    b = await async_node(a)
    return b
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is True
        assert result.output == 20  # (5 * 2) + 10
    
    @pytest.mark.asyncio
    async def test_file_not_found(self, runner):
        result = await runner.run_workflow_file("nonexistent.holon.py", "main")
        
        assert result.success is False
        assert isinstance(result.error, FileNotFoundError)
    
    @pytest.mark.asyncio
    async def test_invalid_file_extension(self, runner, tmp_path):
        workflow_file = tmp_path / "test.txt"
        workflow_file.write_text("not a workflow")
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is False
        assert isinstance(result.error, ValueError)
        assert "must be a .holon.py file" in str(result.error)
    
    @pytest.mark.asyncio
    async def test_workflow_not_found(self, runner, tmp_path):
        workflow_file = tmp_path / "test.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@workflow
async def other_workflow():
    return "test"
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is False
        assert isinstance(result.error, AttributeError)
        assert "not found" in str(result.error)
    
    @pytest.mark.asyncio
    async def test_function_not_workflow(self, runner, tmp_path):
        workflow_file = tmp_path / "test.holon.py"
        workflow_file.write_text('''
from holon import node

@node
def main():
    return "I'm a node, not a workflow"
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is False
        assert isinstance(result.error, TypeError)
        assert "not decorated with @workflow" in str(result.error)
    
    @pytest.mark.asyncio
    async def test_execution_error(self, runner, tmp_path):
        workflow_file = tmp_path / "error.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def failing_node():
    raise RuntimeError("Intentional error")

@workflow
def main():
    return failing_node()
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is False
        assert isinstance(result.error, RuntimeError)
        assert "Intentional error" in str(result.error)
    
    @pytest.mark.asyncio
    async def test_workflow_with_arguments(self, runner, tmp_path):
        workflow_file = tmp_path / "args.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def multiply(x: int, factor: int) -> int:
    return x * factor

@workflow
def main(input_value: int) -> int:
    return multiply(input_value, 3)
''')
        
        result = await runner.run_workflow_file(workflow_file, "main", input_value=7)
        
        assert result.success is True
        assert result.output == 21
    
    @pytest.mark.asyncio
    async def test_sync_workflow(self, runner, tmp_path):
        # Test that sync workflows also work
        workflow_file = tmp_path / "sync.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def double(x: int) -> int:
    return x * 2

@workflow
def main() -> int:
    return double(5)
''')
        
        result = await runner.run_workflow_file(workflow_file, "main")
        
        assert result.success is True
        assert result.output == 10


class TestSyncWrapper:
    """Test the synchronous wrapper function."""
    
    def test_run_workflow_sync(self, tmp_path):
        workflow_file = tmp_path / "sync_test.holon.py"
        workflow_file.write_text('''
from holon import node, workflow

@node
def get_answer() -> int:
    return 42

@workflow
async def main() -> int:
    return get_answer()
''')
        
        result = run_workflow_sync(workflow_file, "main")
        
        assert result.success is True
        assert result.output == 42
    
    def test_sync_wrapper_error(self):
        result = run_workflow_sync("nonexistent.holon.py", "main")
        
        assert result.success is False
        assert isinstance(result.error, FileNotFoundError)
