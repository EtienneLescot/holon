#!/usr/bin/env python3
"""Run the multi-agent example workflow."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Add core to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from holon.runner import WorkflowRunner


async def main():
    print("\n" + "=" * 70)
    print("  Multi-Agent Workflow with Spec Nodes")
    print("=" * 70 + "\n")
    
    runner = WorkflowRunner()
    workflow_file = Path(__file__).parent / "multi_agent.holon.py"
    
    # Test with a positive message
    print("▶ Running workflow with positive input...")
    result = await runner.run_workflow_file(
        workflow_file,
        "multi_agent_workflow",
        user_input="This is great! I love how the spec nodes work perfectly."
    )
    
    if result.success:
        print("\n✓ Success!\n")
        print(json.dumps(result.output, indent=2))
    else:
        print(f"\n✗ Error: {result.error}")
    
    print("\n" + "=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
