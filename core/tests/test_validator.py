"""Tests for workflow graph validation."""
import pytest
from holon.services.validator import validate_graph, ValidationError
from holon.domain.models import Graph, Node, Edge


def test_validate_no_trigger():
    """Should fail when workflow has no trigger nodes."""
    graph = Graph(
        nodes=[
            Node(
                id="node1",
                name="Agent",
                kind="spec",
                node_type="langchain.agent",
            ),
        ],
        edges=[],
    )
    
    with pytest.raises(ValidationError) as exc_info:
        validate_graph(graph)
    
    assert "exactly one trigger" in str(exc_info.value).lower()


def test_validate_single_trigger_ok():
    """Should pass when workflow has exactly one trigger."""
    graph = Graph(
        nodes=[
            Node(
                id="trigger1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="node1",
                name="Agent",
                kind="spec",
                node_type="langchain.agent",
            ),
        ],
        edges=[],
    )
    
    # Should not raise
    validate_graph(graph)


def test_validate_multiple_triggers():
    """Should fail when workflow has more than one trigger."""
    graph = Graph(
        nodes=[
            Node(
                id="trigger1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="trigger2",
                name="ManualTrigger",
                kind="spec",
                node_type="trigger.manual",
            ),
        ],
        edges=[],
    )
    
    with pytest.raises(ValidationError) as exc_info:
        validate_graph(graph)
    
    error_msg = str(exc_info.value).lower()
    assert "one trigger" in error_msg
    assert "found 2" in error_msg


@pytest.mark.skip(reason="Required ports validation needs registry integration")
def test_validate_required_ports_missing():
    """Should fail when required input port is not connected."""
    graph = Graph(
        nodes=[
            Node(
                id="trigger1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="agent1",
                name="Agent",
                kind="spec",
                node_type="langchain.agent",
            ),
            Node(
                id="llm1",
                name="LLM",
                kind="spec",
                node_type="langchain.openai",
            ),
        ],
        # Agent has chat→agent connection but missing LLM connection
        edges=[
            Edge(
                source="trigger1",
                target="agent1",
                source_port="out",
                target_port="input",
            ),
        ],
    )
    
    with pytest.raises(ValidationError) as exc_info:
        validate_graph(graph)
    
    error_msg = str(exc_info.value).lower()
    assert "agent1" in error_msg
    assert "llm" in error_msg
    assert "required" in error_msg


def test_validate_required_ports_connected():
    """Should pass when all required ports are connected."""
    graph = Graph(
        nodes=[
            Node(
                id="trigger1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="agent1",
                name="Agent",
                kind="spec",
                node_type="langchain.agent",
            ),
            Node(
                id="llm1",
                name="LLM",
                kind="spec",
                node_type="langchain.openai",
            ),
        ],
        edges=[
            Edge(
                source="trigger1",
                target="agent1",
                source_port="out",
                target_port="input",
            ),
            Edge(
                source="llm1",
                target="agent1",
                source_port="output",
                target_port="llm",
            ),
        ],
    )
    
    # Should not raise
    validate_graph(graph)


def test_validate_chat_response_loop():
    """Should pass for valid chat→agent→chat response loop."""
    graph = Graph(
        nodes=[
            Node(
                id="chat1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="agent1",
                name="Agent",
                kind="spec",
                node_type="langchain.agent",
            ),
            Node(
                id="llm1",
                name="LLM",
                kind="spec",
                node_type="langchain.openai",
            ),
        ],
        edges=[
            Edge(
                source="chat1",
                target="agent1",
                source_port="out",
                target_port="input",
            ),
            Edge(
                source="llm1",
                target="agent1",
                source_port="output",
                target_port="llm",
            ),
            Edge(
                source="agent1",
                target="chat1",
                source_port="output",
                target_port="response",
            ),
        ],
    )
    
    # Should not raise
    validate_graph(graph)


def test_validate_empty_workflow():
    """Should fail for empty workflow (no nodes)."""
    graph = Graph(nodes=[], edges=[])
    
    with pytest.raises(ValidationError) as exc_info:
        validate_graph(graph)
    
    assert "exactly one trigger" in str(exc_info.value).lower()


def test_validate_node_without_type():
    """Should handle nodes without node_type gracefully."""
    graph = Graph(
        nodes=[
            Node(
                id="trigger1",
                name="ChatTrigger",
                kind="spec",
                node_type="trigger.chat",
            ),
            Node(
                id="node1",
                name="SomeNode",
                kind="inline_code",  # Legacy inline_code node without type
            ),
        ],
        edges=[],
    )
    
    # Should not crash, should pass trigger validation
    validate_graph(graph)
