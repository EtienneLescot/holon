from __future__ import annotations

from holon import node, workflow, link, spec

@node(type = "llm.model", id = "node:llm_model:0b68b23e-fd77-4085-81bd-d9cb39f17e10")
class LlmModel:
    "LLM Model"
    model_name = "gpt-4o"
    temperature = 0.7

@node(type = "langchain.agent", id = "node:langchain_agent:a146d5b4-08d8-4909-a109-e2ec8fd3719f")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."

# LLM Model configuration
@node(type="llm.model", id="node:llm_model:gpt4o")
class GPT4o:
    """GPT-4o language model."""
    provider = "openai"
    model_name = "gpt-4o-mini"
    temperature = 0.7

# Simple Agent configuration
@node(type="langchain.agent", id="node:agent:chat")
class SimpleChatAgent:
    """Simple chat agent."""
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a short joke about robots."


@workflow
async def main() -> str:
    """Simple workflow: connect LLM to agent and execute."""
    
    @link
    class _:
        source = (GPT4o, "output")
        target = (SimpleChatAgent, "llm")
    
    # The agent will use user_prompt from its props as input
    # In the future, we could connect an input node here
    
    return "Workflow will execute via graph engine"
