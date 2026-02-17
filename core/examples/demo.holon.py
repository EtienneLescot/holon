from __future__ import annotations

from holon import node, links

@node(type="trigger.chat", id="node:trigger:chat:main")
class TriggerChat:
    "Chat Trigger"
    placeholder = "Posez votre question..."
    max_history = 50
    auto_scroll = True
    show_timestamps = True
    allow_markdown = True


@node(type="langchain.agent", id="node:langchain:agent:assistant")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = ""


@node(type="llm.model", id="node:llm:model:gpt4o")
class LlmModel:
    "LLM Model"
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.7


@links
def define_routing():
    """Definition des connexions : Control Flow et Data Flow."""
    
    # 1. DEPENDENCY BINDING (Resource Injection)
    # The agent needs an LLM to process requests
    LangchainAgent.uses(llm=LlmModel.output)
    
    # 2. PIPELINE FLOW (Execution & Data Transport)
    # User message flows from chat to agent
    TriggerChat.out >> LangchainAgent.input
    
    # Agent response loops back to chat display
    LangchainAgent.output >> TriggerChat.response
