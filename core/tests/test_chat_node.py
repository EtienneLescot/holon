"""Tests for chat node type resolution and behavior."""

from holon.library.ui_nodes import resolve_chat_node
from holon.domain.models import DataEnvelope


def test_chat_node_resolution():
    """Test that chat node resolves with correct structure."""
    props = {
        "id": "spec:chat:test",
        "placeholder": "Test placeholder",
        "max_history": 100,
    }
    node = resolve_chat_node(props)
    
    assert node.type == "ui.chat"
    assert node.id == "spec:chat:test"
    assert node.label == "Chat"
    assert len(node.inputs) == 1
    assert len(node.outputs) == 1
    
    # Check input port
    assert node.inputs[0].id == "in"
    assert node.inputs[0].kind == "data"
    assert node.inputs[0].multi is True
    
    # Check output port
    assert node.outputs[0].id == "out"
    assert node.outputs[0].kind == "data"
    
    # Check props
    assert node.props["placeholder"] == "Test placeholder"
    assert node.props["max_history"] == 100


def test_chat_node_default_props():
    """Test that chat node uses default props when not specified."""
    props = {"id": "spec:chat:default"}
    node = resolve_chat_node(props)
    
    assert node.props["placeholder"] == "Tapez votre message..."
    assert node.props["max_history"] == 50
    assert node.props["auto_scroll"] is True
    assert node.props["show_timestamps"] is True
    assert node.props["allow_markdown"] is True
    assert node.props["theme"] == "default"


def test_chat_message_envelope_user():
    """Test creating a user message envelope."""
    envelope = DataEnvelope(
        type="message",
        content="Hello, can you help me?",
        contentType="text/plain",
        metadata={
            "role": "user",
            "conversationId": "conv_123",
        },
        origin={
            "nodeId": "spec:chat:main",
            "port": "out",
        },
    )
    
    assert envelope.type == "message"
    assert envelope.content == "Hello, can you help me?"
    assert envelope.contentType == "text/plain"
    assert envelope.metadata["role"] == "user"
    assert envelope.metadata["conversationId"] == "conv_123"
    assert envelope.origin["nodeId"] == "spec:chat:main"
    assert envelope.origin["port"] == "out"


def test_chat_message_envelope_assistant():
    """Test creating an assistant message envelope."""
    envelope = DataEnvelope(
        type="message",
        content="Of course! I'm here to help.",
        contentType="text/plain",
        metadata={
            "role": "assistant",
            "model": "gpt-4o",
            "conversationId": "conv_123",
        },
        origin={
            "nodeId": "spec:agent:1",
            "port": "out.response",
        },
    )
    
    assert envelope.type == "message"
    assert envelope.metadata["role"] == "assistant"
    assert envelope.metadata["model"] == "gpt-4o"


def test_chat_control_envelope():
    """Test creating a control command envelope."""
    envelope = DataEnvelope(
        type="control",
        content={"action": "clear_history"},
        contentType="application/json",
        origin={
            "nodeId": "spec:control:1",
            "port": "out.command",
        },
    )
    
    assert envelope.type == "control"
    assert envelope.content["action"] == "clear_history"
    assert envelope.contentType == "application/json"


def test_chat_event_envelope():
    """Test creating an event envelope."""
    envelope = DataEnvelope(
        type="event",
        content={
            "action": "message_sent",
            "messageId": "msg_123",
        },
        contentType="application/json",
        origin={
            "nodeId": "spec:chat:main",
            "port": "out.event",
        },
    )
    
    assert envelope.type == "event"
    assert envelope.content["action"] == "message_sent"
    assert envelope.content["messageId"] == "msg_123"
