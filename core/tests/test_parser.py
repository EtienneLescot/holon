"""Unit tests for the Phase 1 parser.

These tests validate the LibCST-based decorator detection used to identify Holon
nodes in user source code.
"""

from __future__ import annotations

import textwrap

import libcst as cst

from holon.services.parser import count_node_decorated_functions, parse_functions


def test_counts_simple_node_decorator() -> None:
    source = textwrap.dedent(
        """
        from holon import node

        @node
        def a():
            pass

        def b():
            pass
        """
    )
    assert count_node_decorated_functions(source) == 1

    functions = parse_functions(source)
    assert [(f.kind, f.name) for f in functions] == [("node", "a")]


def test_counts_node_call_syntax() -> None:
    source = textwrap.dedent(
        """
        from holon import node

        @node(name="x")
        def a():
            pass

        @node()
        def b():
            pass
        """
    )
    assert count_node_decorated_functions(source) == 2

    functions = parse_functions(source)
    assert [(f.kind, f.name) for f in functions] == [("node", "a"), ("node", "b")]


def test_counts_attribute_access_decorator() -> None:
    source = textwrap.dedent(
        """
        import holon

        @holon.node
        def a():
            pass

        @holon.node(name="x")
        def b():
            pass
        """
    )
    assert count_node_decorated_functions(source) == 2

    functions = parse_functions(source)
    assert [(f.kind, f.name) for f in functions] == [("node", "a"), ("node", "b")]


def test_does_not_count_similar_names() -> None:
    source = textwrap.dedent(
        """
        def node():
            pass

        @node2
        def a():
            pass

        @workflow
        def b():
            pass
        """
    )
    assert count_node_decorated_functions(source) == 0
    assert [(f.kind, f.name) for f in parse_functions(source)] == [("workflow", "b")]


def test_counts_methods_too() -> None:
    source = textwrap.dedent(
        """
        from holon import node

        class X:
            @node
            def m(self):
                pass
        """
    )
    assert count_node_decorated_functions(source) == 1
    assert [(f.kind, f.name) for f in parse_functions(source)] == [("node", "m")]


def test_extracts_workflows_too() -> None:
    source = textwrap.dedent(
        """
        from holon import node, workflow

        @node
        def a():
            pass

        @workflow
        async def main():
            await a()
        """
    )
    functions = parse_functions(source)
    assert [(f.kind, f.name) for f in functions] == [("node", "a"), ("workflow", "main")]


def test_raises_on_invalid_syntax() -> None:
    source = "def broken(\n"
    try:
        count_node_decorated_functions(source)
    except cst.ParserSyntaxError:
        return
    raise AssertionError("Expected libcst.ParserSyntaxError")
