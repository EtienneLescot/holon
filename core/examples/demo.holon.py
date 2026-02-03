from __future__ import annotations

from holon import node, workflow, link, spec

@node(type = "llm.model", id = "node:llm_model:ec1cad4c-90cd-4d8e-bff1-17ce9ab6e055")
class LlmModel:
    "LLM Model"
    provider = "openai"
    model_name = "gpt-4.1-mini"
    temperature = 0.7

@node(type = "langchain.agent", id = "node:langchain_agent:0734cde9-bfba-45ae-bf30-b945db1c1082")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."


@workflow
async def main() -> str:
    """Simple workflow: connect LLM to agent and execute."""
    
    @link
    class _:
        source = (GPT4o, "output")
        target = (SimpleChatAgent, "llm")
    link("node:llm_model:ec1cad4c-90cd-4d8e-bff1-17ce9ab6e055", "output", "node:langchain_agent:0734cde9-bfba-45ae-bf30-b945db1c1082", "input")
    link("workflow:main", "start", "node:llm_model:ec1cad4c-90cd-4d8e-bff1-17ce9ab6e055", "input")
    
    # The agent will use user_prompt from its props as input
    # In the future, we could connect an input node here
    
    return "Workflow will execute via graph engine"
