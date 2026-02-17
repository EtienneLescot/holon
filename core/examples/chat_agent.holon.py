"""
Chat Agent Example - Interactive conversation loop

This example demonstrates a bidirectional chat system where:
- User sends messages via the Chat Trigger
- Messages are routed to a LangChain agent
- Agent responses loop back to the Chat

Flow: User → ChatTrigger → Agent → ChatTrigger → User (loop)
"""

from holon import node, links


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


@links
def define_routing():
    """
    Define workflow connections.
    
    Separates two types of connections:
    1. Dependency Binding (.uses): Resource injection before execution
    2. Pipeline Flow (>>): Chronological data flow during execution
    """
    
    # 1. DEPENDENCY BINDING - Equip the agent with required resources
    AgentNode.uses(llm=LlmModel.output)
    
    # 2. PIPELINE FLOW - Define the conversation loop
    ChatTrigger.out >> AgentNode.input
    AgentNode.output >> ChatTrigger.response


if __name__ == "__main__":
    # Call the routing definition to register connections
    define_routing()
    print("Chat workflow connections defined")
