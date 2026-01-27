"""Unit tests for graph parsing (Phase 4.1)."""

from __future__ import annotations

import textwrap

from holon.services.graph_parser import parse_graph


def test_parse_graph_extracts_nodes_and_edges() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow

        @node
        def analyze(x: int) -> int:
            return x + 1

        @node
        async def summarize(x: int) -> str:
            return str(x)

        @workflow
        async def main() -> None:
            y = analyze(1)
            await summarize(y)
        """
    )

    graph = parse_graph(source)

    assert [(n.kind, n.name) for n in graph.nodes] == [
        ("node", "analyze"),
        ("node", "summarize"),
        ("workflow", "main"),
    ]

    assert [(e.source, e.target) for e in graph.edges] == [
        ("workflow:main", "node:analyze"),
        ("workflow:main", "node:summarize"),
    ]


def test_parse_graph_ignores_unknown_calls() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow

        @node
        def a():
            pass

        @workflow
        def main():
            a()
            b()
        """
    )

    graph = parse_graph(source)
    assert [(e.source, e.target) for e in graph.edges] == [("workflow:main", "node:a")]
