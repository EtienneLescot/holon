"""Demo script: rename a Holon node and update workflow call sites.

This is a Phase 2 proof-of-concept.

Run:
    poetry run python -m examples.demo_rename_node
"""

from __future__ import annotations

from pathlib import Path

from holon.services.patcher import rename_node


def _main() -> None:
    example_path = Path(__file__).with_name("simple_workflow.py")
    source = example_path.read_text(encoding="utf-8")

    updated = rename_node(source, old_name="analyze_sentiment", new_name="analyze_sentiment_v2")

    if "def analyze_sentiment(" in updated:
        raise SystemExit("Rename failed: old definition still present")
    if "def analyze_sentiment_v2(" not in updated:
        raise SystemExit("Rename failed: new definition not present")
    if "await analyze_sentiment(" in updated:
        raise SystemExit("Rename failed: old call still present")

    print("OK: renamed node and updated workflow call sites")


if __name__ == "__main__":
    _main()
