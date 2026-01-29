#!/usr/bin/env python3
"""Demo: Spec node resolution in workflows.

This demo shows how spec nodes (library nodes) are automatically
resolved to runtime objects during workflow execution.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add core to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from holon.runner import WorkflowRunner
from holon.registry import get_global_registry, register_spec_type


def print_section(title: str) -> None:
    """Print a formatted section header."""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


async def demo_basic_resolution():
    """Demo 1: Basic spec node resolution."""
    print_section("Demo 1: Basic Spec Node Resolution")
    
    runner = WorkflowRunner()
    workflow_file = Path(__file__).parent / "spec_nodes.holon.py"
    
    print(f"Executing: {workflow_file.name}")
    result = await runner.run_workflow_file(workflow_file, "main")
    
    if result.success:
        print(f"\n✓ Success!\n")
        print(result.output)
    else:
        print(f"\n✗ Error: {result.error}")


async def demo_custom_resolver():
    """Demo 2: Custom spec type resolver."""
    print_section("Demo 2: Custom Spec Type Resolver")
    
    # Register a custom type
    @register_spec_type("demo.calculator")
    def resolve_calculator(props: dict) -> object:
        """Resolve a calculator spec node."""
        class Calculator:
            def __init__(self, precision: int = 2):
                self.precision = precision
            
            def add(self, a: float, b: float) -> float:
                return round(a + b, self.precision)
            
            def multiply(self, a: float, b: float) -> float:
                return round(a * b, self.precision)
        
        return Calculator(precision=props.get("precision", 2))
    
    print("✓ Registered custom type: demo.calculator")
    
    # Create a temporary workflow file
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.holon.py', delete=False) as f:
        f.write('''
from holon import node, workflow

@node(type="demo.calculator", id="spec:calc:1")
class MyCalculator:
    precision = 3

@workflow
async def main() -> str:
    result1 = MyCalculator.add(1.234, 5.678)
    result2 = MyCalculator.multiply(2.5, 3.7)
    return f"Add: {result1}, Multiply: {result2}"
''')
        temp_file = Path(f.name)
    
    try:
        runner = WorkflowRunner()
        result = await runner.run_workflow_file(temp_file, "main")
        
        if result.success:
            print(f"\n✓ Workflow executed successfully")
            print(f"  Output: {result.output}")
        else:
            print(f"\n✗ Error: {result.error}")
    finally:
        temp_file.unlink()


async def demo_memory_buffer():
    """Demo 3: Built-in memory buffer resolver."""
    print_section("Demo 3: Built-in Memory Buffer")
    
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.holon.py', delete=False) as f:
        f.write('''
from holon import node, workflow

@node(type="memory.buffer", id="spec:mem:chat")
class ChatMemory:
    max_messages = 5

@workflow
async def main() -> str:
    # Add some messages
    for i in range(7):
        ChatMemory.add(f"message_{i}")
    
    messages = ChatMemory.get_messages()
    return f"Stored {len(messages)} messages (max: {ChatMemory.max_messages})\\nMessages: {messages}"
''')
        temp_file = Path(f.name)
    
    try:
        runner = WorkflowRunner()
        result = await runner.run_workflow_file(temp_file, "main")
        
        if result.success:
            print(f"\n✓ Memory buffer working")
            print(f"  {result.output}")
        else:
            print(f"\n✗ Error: {result.error}")
    finally:
        temp_file.unlink()


async def demo_registry_info():
    """Demo 4: Show registered spec types."""
    print_section("Demo 4: Registered Spec Types")
    
    registry = get_global_registry()
    
    # Get all registered types by trying to resolve with empty props
    registered_types = [
        "llm.model",
        "memory.buffer",
        "tool.function",
        "demo.calculator",  # From demo 2
    ]
    
    print("\nRegistered spec types:")
    for type_id in registered_types:
        if registry.has_resolver(type_id):
            print(f"  ✓ {type_id}")
        else:
            print(f"  ✗ {type_id} (not registered)")


async def main():
    """Run all demos."""
    print("\n" + "🚀" * 30)
    print("  Holon Spec Node Resolution Demo")
    print("🚀" * 30)
    
    await demo_basic_resolution()
    await demo_custom_resolver()
    await demo_memory_buffer()
    await demo_registry_info()
    
    print("\n" + "=" * 60)
    print("  ✨ All demos complete!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
