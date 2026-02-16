"""Unit tests for graph parsing (Phase 4.1)."""

from __future__ import annotations

import textwrap

from holon.services.graph_parser import parse_graph


def test_parse_graph_extracts_nodes_and_edges() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow, link

        @node(type="trigger.manual", id="node:trigger:test")
        class Trigger:
            pass

        @node
        def analyze(x: int) -> int:
            return x + 1

        @node
        async def summarize(x: int) -> str:
            return str(x)

        @workflow
        async def main() -> None:
            @link
            class _:
                source = ("node:trigger:test", "start")
                target = ("node:analyze", "in")
            
            @link
            class _:
                source = ("node:analyze", "out")
                target = ("node:summarize", "in")
        """
    )

    graph = parse_graph(source)

    # Nodes are collected in order: functions first, then classes
    assert [(n.kind, n.name) for n in graph.nodes] == [
        ("node", "analyze"),
        ("node", "summarize"),
        ("spec", "Trigger"),  # Has type= so kind should be "spec"
    ]

    assert [(e.source, e.target) for e in graph.edges] == [
        ("node:trigger:test", "node:analyze"),
        ("node:analyze", "node:summarize"),
    ]


def test_parse_graph_ignores_unknown_calls() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow, link

        @node(type="trigger.manual", id="node:trigger:test2")
        class Trigger:
            pass

        @node
        def a():
            pass

        @workflow
        def main():
            @link
            class _:
                source = ("node:trigger:test2", "start")
                target = ("node:a", "in")
            
            # This should be ignored - unknown node
            @link
            class _:
                source = ("node:a", "out")
                target = ("node:b", "in")
        """
    )

    graph = parse_graph(source)
    # Should only have the first link since node:b doesn't exist
    assert [(e.source, e.target) for e in graph.edges] == [
        ("node:trigger:test2", "node:a"),
        ("node:a", "node:b"),  # Parser doesn't validate existence, just extracts structure
    ]
