"""Simple workflow example for testing the execution engine.

This is a minimal example demonstrating:
- Basic @node functions (sync and async)
- A @workflow that orchestrates them
- Simple data flow between nodes
"""

from __future__ import annotations

from holon import node, workflow


@node
def add(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y


@node
def multiply(x: int, factor: int) -> int:
    """Multiply a number by a factor."""
    return x * factor


@node
async def format_result(value: int) -> str:
    """Format the result as a string."""
    return f"Final result: {value}"


@workflow
async def main() -> str:
    """Simple workflow that adds, multiplies, and formats."""
    # Step 1: Add 5 + 3
    sum_result = add(5, 3)
    
    # Step 2: Multiply by 2
    product = multiply(sum_result, 2)
    
    # Step 3: Format the result
    formatted = await format_result(product)
    
    return formatted


# Expected output: "Final result: 16" (because (5 + 3) * 2 = 16)
