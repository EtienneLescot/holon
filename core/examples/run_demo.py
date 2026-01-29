#!/usr/bin/env python3
"""Demo script to test the workflow runner.

This script demonstrates how to execute a Holon workflow using the runner.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add core to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from holon.runner import WorkflowRunner, run_workflow_sync


async def demo_async():
    """Demonstrate async workflow execution."""
    print("=" * 60)
    print("Holon Workflow Runner - Async Demo")
    print("=" * 60)
    
    runner = WorkflowRunner()
    
    # Execute the simple workflow
    workflow_file = Path(__file__).parent / "simple_exec.holon.py"
    print(f"\n▶ Executing workflow: {workflow_file.name}")
    print(f"  Entrypoint: main()")
    
    result = await runner.run_workflow_file(workflow_file, "main")
    
    print("\n" + "─" * 60)
    if result.success:
        print(f"✓ Success!")
        print(f"  Output: {result.output}")
    else:
        print(f"✗ Error!")
        print(f"  {type(result.error).__name__}: {result.error}")
    print("─" * 60)


def demo_sync():
    """Demonstrate synchronous workflow execution."""
    print("\n\n" + "=" * 60)
    print("Holon Workflow Runner - Sync Demo")
    print("=" * 60)
    
    workflow_file = Path(__file__).parent / "simple_exec.holon.py"
    print(f"\n▶ Executing workflow: {workflow_file.name}")
    print(f"  Entrypoint: main()")
    
    result = run_workflow_sync(workflow_file, "main")
    
    print("\n" + "─" * 60)
    if result.success:
        print(f"✓ Success!")
        print(f"  Output: {result.output}")
    else:
        print(f"✗ Error!")
        print(f"  {type(result.error).__name__}: {result.error}")
    print("─" * 60)


if __name__ == "__main__":
    print("\n🚀 Starting Holon Workflow Runner Demo\n")
    
    # Run async demo
    asyncio.run(demo_async())
    
    # Run sync demo
    demo_sync()
    
    print("\n\n✨ Demo complete!\n")
