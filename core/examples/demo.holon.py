from __future__ import annotations

from holon import node, workflow, link, spec

@node(type = "langchain.agent", id = "node:langchain_agent:eac30101-47ea-4054-86e5-c5bd556e5611")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."

@node(type = "langchain.agent", id = "node:langchain_agent:f2e6a12b-3e5b-4a99-a8ad-6a1af300997e")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."

@node(type = "llm.model", id = "node:llm_model:34370cdf-5a9e-4c92-ae47-f4179ac26bbc")
class LlmModel:
    "LLM Model"
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.7

@node(type = "ui.chat", id = "node:ui_chat:010180e3-0edd-471c-bc29-22149d1ae7e9")
class Chat:
    "Chat"
    placeholder = "Tapez votre message..."
    max_history = 50
    auto_scroll = True
    show_timestamps = True
    allow_markdown = True
    theme = "default"


@workflow
async def main() -> str:
    """Simple workflow: connect LLM to agent and execute."""

    @link
    class _:
        source = ("workflow:main", "start")
        target = ("node:ui_chat:010180e3-0edd-471c-bc29-22149d1ae7e9", "in.message")

    @link
    class _:
        source = ("node:ui_chat:010180e3-0edd-471c-bc29-22149d1ae7e9", "out.message")
        target = ("node:langchain_agent:f2e6a12b-3e5b-4a99-a8ad-6a1af300997e", "input")

    @link
    class _:
        source = ("node:llm_model:34370cdf-5a9e-4c92-ae47-f4179ac26bbc", "output")
        target = ("node:langchain_agent:f2e6a12b-3e5b-4a99-a8ad-6a1af300997e", "llm")
    link("node:llm_model:34370cdf-5a9e-4c92-ae47-f4179ac26bbc", "output", "node:langchain_agent:eac30101-47ea-4054-86e5-c5bd556e5611", "input")
    
    # The agent will use user_prompt from its props as input
    # In the future, we could connect an input node here
    
    return "Workflow will execute via graph engine"
