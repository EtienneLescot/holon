"""
Simple Chat Trigger Demo

This example demonstrates a standalone chat trigger node.
Messages can be typed and displayed without connecting to an agent.
Useful for testing the chat interface and understanding triggers.
"""

from holon import node


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


# No workflow connections needed - this is a standalone trigger demo

if __name__ == "__main__":
    print("Chat trigger demo loaded - interact with the node in the UI")
