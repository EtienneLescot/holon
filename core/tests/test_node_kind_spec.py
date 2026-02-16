"""Tests to prevent regression: @node(type=...) should create kind="spec" nodes."""

from __future__ import annotations

import textwrap

from holon.services.graph_parser import parse_graph


def test_node_decorator_with_type_creates_spec_kind() -> None:
    """Regression test: @node(type=..., id=...) should create kind="spec" not kind="node"."""
    source = textwrap.dedent(
        """
        from holon import node

        @node(type="langchain.agent", id="spec:agent:1")
        class MyAgent:
            "LangChain Agent"
            system_prompt = "You are helpful."
        """
    )

    graph = parse_graph(source)
    
    assert len(graph.nodes) == 1
    node = graph.nodes[0]
    
    # Critical assertions to prevent regression
    assert node.kind == "spec", f"Node with type= should have kind='spec', got '{node.kind}'"
    assert node.node_type == "langchain.agent"
    assert node.id == "spec:agent:1"
    assert node.name == "MyAgent"
    assert node.label == "LangChain Agent"
    assert node.props is not None
    assert node.props.get("system_prompt") == "You are helpful."


def test_node_decorator_without_type_creates_node_kind() -> None:
    """Regular @node without type= should create kind="node"."""
    source = textwrap.dedent(
        """
        from holon import node

        @node
        def my_processor(x: int) -> int:
            return x + 1
        """
    )

    graph = parse_graph(source)
    
    assert len(graph.nodes) == 1
    node = graph.nodes[0]
    
    assert node.kind == "node"
    assert node.node_type is None
    assert node.id == "node:my_processor"


def test_multiple_spec_nodes_all_have_spec_kind() -> None:
    """Multiple @node(type=...) declarations should all be kind="spec"."""
    source = textwrap.dedent(
        """
        from holon import node

        @node(type="langchain.agent", id="spec:agent:1")
        class Agent1:
            system_prompt = "First agent"

        @node(type="llm.model", id="spec:llm:1")
        class LLM1:
            provider = "openai"
            model_name = "gpt-4o"

        @node(type="trigger.chat", id="spec:trigger:1")
        class ChatTrigger:
            placeholder = "Type here..."
        """
    )

    graph = parse_graph(source)
    
    assert len(graph.nodes) == 3
    
    for node in graph.nodes:
        assert node.kind == "spec", f"Node {node.name} should have kind='spec', got '{node.kind}'"
        assert node.node_type is not None, f"Node {node.name} should have node_type"
