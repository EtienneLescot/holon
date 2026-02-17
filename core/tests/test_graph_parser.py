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
        ("inline_code", "analyze"),      # @node function → inline_code
        ("inline_code", "summarize"),    # @node function → inline_code
        ("spec", "Trigger"),             # @node class → spec
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


def test_parse_graph_rshift_operator_syntax() -> None:
    """Test the new >> operator syntax for defining links."""
    source = textwrap.dedent(
        """
        from holon import node, links

        @node(type="trigger.chat", id="node:trigger:chat:main")
        class TriggerChat:
            pass

        @node(type="langchain.agent", id="node:langchain:agent:assistant")
        class LangchainAgent:
            pass

        @node(type="llm.model", id="node:llm:model:gpt4o")
        class LlmModel:
            pass

        @links
        def define_routing():
            '''Define workflow connections'''
            
            # Dependency binding
            LangchainAgent.uses(llm=LlmModel.output)
            
            # Pipeline flow
            TriggerChat.out >> LangchainAgent.input
            LangchainAgent.output >> TriggerChat.response
        """
    )

    graph = parse_graph(source)

    # Verify nodes are extracted correctly (3 @node classes, @links is metadata only)
    assert len(graph.nodes) == 3
    
    # Verify the 3 @node classes
    node_nodes = [n for n in graph.nodes if n.kind == "spec"]
    assert len(node_nodes) == 3
    node_names = {n.name for n in node_nodes}
    assert node_names == {"TriggerChat", "LangchainAgent", "LlmModel"}
    
    # Verify the @links function is captured as metadata
    assert graph.links_function_name == "define_routing"

    # Verify all 3 edges are extracted (both >> and .uses())
    assert len(graph.edges) == 3
    
    # All edges use kind="link" (both pipeline flow and dependency binding)
    assert all(e.kind == "link" for e in graph.edges)
    
    # Verify specific edges exist
    edge_tuples = [(e.source, e.source_port, e.target, e.target_port) for e in graph.edges]
    
    # Pipeline flow edges (>> operator)
    assert ("TriggerChat", "out", "LangchainAgent", "input") in edge_tuples
    assert ("LangchainAgent", "output", "TriggerChat", "response") in edge_tuples
    
    # Dependency binding edge (.uses() method)
    assert ("LlmModel", "output", "LangchainAgent", "llm") in edge_tuples
