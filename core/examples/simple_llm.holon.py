from __future__ import annotations

from holon import node, workflow, link

# Simple LLM Model
@node(type="llm.model", id="node:llm_model:simple")
class GPT4o:
    """GPT-4o language model."""
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.7

# Simple Agent
@node(type="langchain.agent", id="node:agent:chat")
class SimpleChatAgent:
    """Simple chat agent."""
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a short joke about robots."


@workflow
async def main() -> str:
    """Simple workflow: connect LLM to agent and execute."""
    # Connect LLM to agent's llm port
    link("spec:llm.model:simple", "llm", "spec:agent.simple:chat", "llm")
    link("workflow:main", "start", "spec:agent.simple:chat", "input")
    
    # The agent will use user_prompt from its props as input
    # In the future, we could connect an input node here
    
    return "Workflow will execute via graph engine"
