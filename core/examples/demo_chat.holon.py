"""
Simple Chat Node Demo

This example demonstrates a standalone chat UI node.
Messages can be typed and displayed, without connecting to an agent.
Useful for testing the chat interface and understanding the basic structure.
"""

from holon import node, workflow


# Standalone Chat UI Node
@node(type="ui.chat", id="spec:chat:demo")
class ChatDemo:
    """Interactive chat interface for testing."""
    placeholder: str = "Type a message to test the chat UI..."
    max_history: int = 20
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = False
    theme: str = "default"


@workflow
async def main() -> str:
    """
    Simple chat demo workflow.
    
    This creates a standalone chat node that can display messages.
    To test end-to-end chat functionality, use chat_agent.holon.py instead.
    """
    return "Chat demo loaded - interact with the node in the UI"


if __name__ == "__main__":
    import asyncio
    result = asyncio.run(main())
    print(result)
