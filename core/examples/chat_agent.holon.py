"""
Chat Agent Example - Interactive conversation loop

This example demonstrates a bidirectional chat system where:
- User sends messages via the Chat Trigger
- Messages are routed to a LangChain agent
- Agent responses loop back to the Chat

Flow: User → ChatTrigger → Agent → ChatTrigger → User (loop)
"""

from holon import node, workflow, link


# Chat Trigger
@node(type="trigger.chat", id="node:trigger:chat:conversation")
class ChatTrigger:
    """Interactive chat trigger for user input/output."""
    placeholder: str = "Posez votre question..."
    max_history: int = 50
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = True


# LangChain Agent Node
@node(type="langchain.agent", id="node:agent:conversational")
class AgentNode:
    """Conversational LangChain agent."""
    system_prompt: str = """Tu es un assistant utile et bienveillant. 
Tu réponds de manière concise et claire aux questions de l'utilisateur."""
    user_prompt: str = ""


# LLM Model
@node(type="llm.model", id="node:llm:agent_model")
class LlmModel:
    """GPT-4o model for the agent."""
    provider: str = "openai"
    model_name: str = "gpt-4o"
    temperature: float = 0.7


@workflow
async def main() -> str:
    """
    Interactive chat loop with agent.
    
    The workflow establishes a bidirectional connection:
    1. User messages from chat → agent input
    2. Agent responses → chat display (loop back)
    """
    
    # Chat user message → Agent
    @link
    class _:
        source = ("node:trigger:chat:conversation", "out")
        target = ("node:agent:conversational", "input")
    
    # LLM → Agent (required)
    @link
    class _:
        source = ("node:llm:agent_model", "output")
        target = ("node:agent:conversational", "llm")
    
    # Agent response → Chat (loop back)
    @link
    class _:
        source = ("node:agent:conversational", "output")
        target = ("node:trigger:chat:conversation", "response")
    
    # The workflow remains active to maintain the conversation loop
    return "Chat system active - waiting for user input"


if __name__ == "__main__":
    import asyncio
    result = asyncio.run(main())
    print(result)
