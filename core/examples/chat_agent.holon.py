"""
Chat Agent Example - Interactive conversation loop

This example demonstrates a bidirectional chat system where:
- User sends messages via the Chat UI node
- Messages are routed to a LangChain agent
- Agent responses are displayed back in the Chat UI

Flow: User → ChatNode → Agent → ChatNode → User
"""

from holon import node, workflow, port_map


# Chat UI Node
@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat interface for user input/output."""
    placeholder: str = "Posez votre question..."
    max_history: int = 50
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = True


# LangChain Agent Node
@node(type="langchain.agent", id="spec:agent:assistant")
class AgentNode:
    """Conversational LangChain agent."""
    system_prompt: str = """Tu es un assistant utile et bienveillant. 
Tu réponds de manière concise et claire aux questions de l'utilisateur."""
    model: str = "gpt-4o"
    temperature: float = 0.7


@workflow
async def main() -> str:
    """
    Interactive chat loop with agent.
    
    The workflow establishes a bidirectional connection:
    1. User messages from chat → agent input
    2. Agent responses → chat display
    """
    
    # Mapping 1: Chat user message → Agent prompt
    # Extracts the message content and maps it to the agent's user input field
    @port_map
    class ChatToAgent:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"  # Extract message content
        target_field = "user"     # Map to user field in agent prompt
    
    # Mapping 2: Agent response → Chat incoming message
    # Routes agent output back to chat for display
    @port_map
    class AgentToChat:
        source = (AgentNode, "out.response")
        target = (ChatNode, "in.message")
        # Identity mapping - pass the whole DataEnvelope
    
    # The workflow remains active to maintain the conversation loop
    return "Chat system active - waiting for user input"


if __name__ == "__main__":
    import asyncio
    result = asyncio.run(main())
    print(result)
