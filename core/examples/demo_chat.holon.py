"""
Simple Chat Trigger Demo

This example demonstrates a standalone chat trigger node.
Messages can be typed and displayed without connecting to an agent.
Useful for testing the chat interface and understanding triggers.
"""

from holon import node, workflow, link


# Manual Trigger as fallback for testing
@node(type="trigger.chat", id="node:trigger:chat:demo")
class ChatTrigger:
    """Interactive chat trigger for testing."""
    placeholder: str = "Type a message to test the chat trigger..."
    max_history: int = 20
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = False
    theme: str = "default"


@workflow
async def main() -> str:
    """
    Simple chat trigger demo workflow.
    
    This creates a standalone chat trigger. The chat starts the workflow
    when a user types a message.
    """
    
    # No connections needed for standalone trigger demo
    
    return "Chat trigger demo loaded - interact with the node in the UI"


if __name__ == "__main__":
    import asyncio
    result = asyncio.run(main())
    print(result)
