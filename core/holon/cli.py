"""Holon CLI - Command line interface for running workflows.

Usage:
    holon run <workflow_file> [--workflow=NAME] [--arg key=value]...
    holon list <workflow_file>
    holon --version
    holon --help

Examples:
    holon run examples/demo.holon.py
    holon run examples/demo.holon.py --workflow=main
    holon run workflow.holon.py --arg input="Hello World"
    holon list examples/demo.holon.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from holon import __version__
from holon.runner import WorkflowRunner
from holon.services.graph_parser import parse_graph


def parse_arg_value(value: str) -> Any:
    """Parse a CLI argument value to appropriate Python type.
    
    Args:
        value: String value from CLI
    
    Returns:
        Parsed value (str, int, float, bool, list, dict, or None)
    """
    # Try JSON first
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        pass
    
    # Try basic types
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if value.lower() == "null" or value.lower() == "none":
        return None
    
    # Try numeric
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        pass
    
    # Default to string
    return value


def cmd_run(args: argparse.Namespace) -> int:
    """Run a workflow from a .holon.py file.
    
    Args:
        args: Parsed command line arguments
    
    Returns:
        Exit code (0 for success, 1 for error)
    """
    workflow_file = Path(args.file)
    
    if not workflow_file.exists():
        print(f"Error: File not found: {workflow_file}", file=sys.stderr)
        return 1
    
    # Parse keyword arguments
    kwargs = {}
    if args.arg:
        for arg in args.arg:
            if "=" not in arg:
                print(f"Error: Invalid argument format: {arg}", file=sys.stderr)
                print("Use: --arg key=value", file=sys.stderr)
                return 1
            
            key, value = arg.split("=", 1)
            kwargs[key.strip()] = parse_arg_value(value.strip())
    
    # Run the workflow
    print(f"▶ Executing: {workflow_file}")
    print(f"  Workflow: {args.workflow}")
    if kwargs:
        print(f"  Arguments: {json.dumps(kwargs, indent=2)}")
    print()
    
    async def run():
        runner = WorkflowRunner()
        result = await runner.run_workflow_file(
            workflow_file,
            args.workflow,
            **kwargs
        )
        return result
    
    result = asyncio.run(run())
    
    print("─" * 70)
    if result.success:
        print("✓ Success!")
        print()
        
        # Pretty print output
        if isinstance(result.output, (dict, list)):
            print(json.dumps(result.output, indent=2))
        else:
            print(f"Output: {result.output}")
        
        print("─" * 70)
        return 0
    else:
        print("✗ Error!")
        print()
        print(f"{type(result.error).__name__}: {result.error}")
        
        # Print traceback if available
        if hasattr(result.error, "__traceback__"):
            import traceback
            print()
            traceback.print_exception(
                type(result.error),
                result.error,
                result.error.__traceback__
            )
        
        print("─" * 70)
        return 1


def cmd_list(args: argparse.Namespace) -> int:
    """List workflows in a .holon.py file.
    
    Args:
        args: Parsed command line arguments
    
    Returns:
        Exit code (0 for success, 1 for error)
    """
    workflow_file = Path(args.file)
    
    if not workflow_file.exists():
        print(f"Error: File not found: {workflow_file}", file=sys.stderr)
        return 1
    
    # Parse the file
    try:
        source = workflow_file.read_text()
        graph = parse_graph(source)
    except Exception as e:
        print(f"Error parsing file: {e}", file=sys.stderr)
        return 1
    
    # Find workflows
    workflows = [node for node in graph.nodes if node.kind == "workflow"]
    nodes = [node for node in graph.nodes if node.kind == "node"]
    specs = [node for node in graph.nodes if node.kind == "spec"]
    
    print(f"File: {workflow_file}")
    print()
    
    if workflows:
        print("Workflows:")
        for wf in workflows:
            print(f"  • {wf.name}")
        print()
    
    if nodes:
        print(f"Nodes: {len(nodes)}")
        for node in nodes[:5]:  # Show first 5
            print(f"  • {node.name}")
        if len(nodes) > 5:
            print(f"  ... and {len(nodes) - 5} more")
        print()
    
    if specs:
        print(f"Spec Nodes: {len(specs)}")
        for spec in specs[:5]:  # Show first 5
            node_type = spec.node_type or "unknown"
            print(f"  • {spec.name} (type: {node_type})")
        if len(specs) > 5:
            print(f"  ... and {len(specs) - 5} more")
        print()
    
    return 0


def main() -> int:
    """Main CLI entry point.
    
    Returns:
        Exit code
    """
    parser = argparse.ArgumentParser(
        prog="holon",
        description="Holon - Code-first AI workflow framework",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  holon run examples/demo.holon.py
  holon run workflow.holon.py --workflow=process --arg input="test"
  holon list examples/demo.holon.py
        """
    )
    
    parser.add_argument(
        "--version",
        action="version",
        version=f"holon {__version__}"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Run command
    run_parser = subparsers.add_parser(
        "run",
        help="Run a workflow from a .holon.py file"
    )
    run_parser.add_argument(
        "file",
        help="Path to the .holon.py file"
    )
    run_parser.add_argument(
        "--workflow",
        default="main",
        help="Name of the workflow function to run (default: main)"
    )
    run_parser.add_argument(
        "--arg",
        action="append",
        help="Workflow argument in key=value format (can be used multiple times)"
    )
    
    # List command
    list_parser = subparsers.add_parser(
        "list",
        help="List workflows and nodes in a .holon.py file"
    )
    list_parser.add_argument(
        "file",
        help="Path to the .holon.py file"
    )
    
    args = parser.parse_args()
    
    if args.command == "run":
        return cmd_run(args)
    elif args.command == "list":
        return cmd_list(args)
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
