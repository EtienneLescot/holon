"""Unit tests for the Phase 2 patcher utilities."""

from __future__ import annotations

import textwrap

from holon.services.patcher import patch_node, patch_spec_node, rename_node


def test_rename_node_updates_def_and_workflow_calls_only() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow

        @node
        async def analyze(ctx, text: str):
            return text

        async def helper():
            # Not a workflow; should not be rewritten.
            return await analyze(None, "x")

        @workflow
        async def main():
            a = await analyze(None, "hello")
            return a
        """
    )

    updated = rename_node(source, old_name="analyze", new_name="analyze_v2")

    assert "async def analyze_v2" in updated
    assert "async def analyze(" not in updated

    # Updated inside workflow
    assert "await analyze_v2" in updated

    # Not updated in non-workflow helper
    assert "return await analyze(None, \"x\")" in updated


def test_rename_node_does_not_touch_similar_identifiers() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow

        @node
        def ping():
            return 1

        @workflow
        def main():
            ping2 = 123
            return ping2
        """
    )

    updated = rename_node(source, old_name="ping", new_name="pong")
    assert "def pong" in updated
    assert "ping2 = 123" in updated


def test_patch_node_replaces_function_definition() -> None:
    source = textwrap.dedent(
        """
        from holon import node

        @node
        def a(x: int) -> int:
            return x + 1
        """
    )

    new_func = textwrap.dedent(
        """
        @node
        def a(x: int) -> int:
            return x + 2
        """
    )

    updated = patch_node(source, node_name="a", new_function_code=new_func)
    assert "return x + 2" in updated
    assert "return x + 1" not in updated


def test_patch_spec_node_updates_matching_spec_call() -> None:
    source = textwrap.dedent(
        """
        from holon import spec

        spec(
            "spec:one",
            type="llm.model",
            label="Model",
            props={"temperature": 0.2},
        )

        spec(
            "spec:two",
            type="tool.example",
            label="Tool",
            props={"enabled": True},
        )
        """
    )

    updated = patch_spec_node(
        source,
        node_id="spec:one",
        label=None,
        props={"temperature": 0.7, "maxTokens": 256},
        set_label=True,
        set_props=True,
    )

    assert "\"spec:one\"" in updated
    assert "\"temperature\": 0.7" in updated
    assert "\"maxTokens\": 256" in updated
    # Label should be cleared (either removed or set to None).
    assert "label=\"Model\"" not in updated

    # Ensure the other spec node is untouched.
    assert "\"spec:two\"" in updated
    assert "label=\"Tool\"" in updated
    assert "\"enabled\": True" in updated
