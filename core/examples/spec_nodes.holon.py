"""Example workflow demonstrating spec node resolution.

This workflow shows how to use spec nodes (library nodes) that are
resolved to runtime objects during execution.
"""

from __future__ import annotations

from holon import node, workflow


# Spec nodes: configured via class attributes, resolved at runtime

@node(type="llm.model", id="spec:llm:gpt4")
class GPT4:
    """GPT-4 language model configuration."""
    model_name = "gpt-4o"
    temperature = 0.7


@node(type="memory.buffer", id="spec:memory:conv")
class ConversationMemory:
    """Conversation memory buffer."""
    max_messages = 10


# Regular @node functions

@node
def prepare_input(text: str) -> str:
    """Prepare input text for processing."""
    return f"User query: {text}"


@node
async def format_response(response: str) -> str:
    """Format the agent response."""
    return f"Assistant: {response}"


# Workflow using both regular nodes and spec nodes

@workflow
async def main(user_input: str = "Hello, how are you?") -> str:
    """Simple workflow demonstrating spec node resolution.
    
    At runtime:
    - GPT4 is resolved to an LLM client (or config object if no resolver)
    - ConversationMemory is resolved to a MemoryBuffer instance
    - Regular nodes work as before
    """
    # Prepare input
    prepared = prepare_input(user_input)
    
    # Access resolved spec nodes
    # Note: In this basic version, they're just config objects
    # In a full implementation, they'd be actual LLM clients/memory stores
    
    # For now, create a mock response
    mock_response = f"Received: {prepared}"
    
    # Format output
    formatted = await format_response(mock_response)
    
    # Return result with metadata
    return f"{formatted}\n\nSpec nodes:\n- LLM: {getattr(GPT4, 'model_name', 'not resolved')}\n- Memory: {getattr(ConversationMemory, 'max_messages', 'not resolved')} messages"


# Expected output demonstrates that spec nodes were resolved
