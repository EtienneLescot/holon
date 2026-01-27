from __future__ import annotations

from holon.dsl import node, workflow


@node
def analyze(x: int) -> int:
    """Toy node for end-to-end demo."""

    return x + 1


@node
async def summarize(x: int) -> str:
    return f"result={x}"


@workflow
async def main() -> str:
    y = analyze(1)
    return await summarize(y)
