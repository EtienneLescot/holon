"""Minimal DSL usage example (Phase 1).

Run it from the Poetry venv:

    poetry run python -m examples.simple_workflow

It will parse its own source and count functions decorated with ``@node``.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from holon import Context, node, workflow
from holon.services.parser import count_node_decorated_functions


class AnalysisResult(BaseModel):
    score: float
    reason: str


@node
async def analyze_sentiment(ctx: Context, text: str) -> AnalysisResult:
    """Analyze sentiment of a text."""

    _ = ctx
    if not text.strip():
        return AnalysisResult(score=0.0, reason="Empty")
    return AnalysisResult(score=0.9, reason="Positive")


@node(name="notify_slack")
async def notify_slack(ctx: Context, result: AnalysisResult) -> None:
    """Pretend to send a message to Slack."""

    _ = (ctx, result)


@workflow
async def main_pipeline() -> None:
    """Orchestrate nodes."""

    ctx = Context()
    result = await analyze_sentiment(ctx, text="Hello world")
    if result.score > 0.5:
        await notify_slack(ctx, result)


def _main() -> None:
    source = Path(__file__).read_text(encoding="utf-8")
    count = count_node_decorated_functions(source)
    print(f"@node-decorated functions: {count}")


if __name__ == "__main__":
    _main()
