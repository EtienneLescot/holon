from __future__ import annotations

from holon import node, workflow, link, spec

@node(type = "langchain.agent", id = "node:langchain_agent:e054688c-a21a-4a70-8946-9e67354e56bb")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."

@node(type = "langchain.agent", id = "node:langchain_agent:076bd2ef-e4c7-44ac-8ff5-c623e795f6cd")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story."

@node(type = "trigger.chat", id = "node:trigger_chat:86ba6668-5e2e-4fd7-8d2f-cbaf4707d361")
class TriggerChat:
    "trigger.chat"


@workflow
async def main() -> str:
    """Simple chat workflow: Chat trigger → Agent → back to Chat."""

    # Chat user message → Agent input
    @link
    class _:
        source = ("node:trigger:chat:main", "out")
        target = ("node:langchain_agent:assistant", "input")

    # LLM → Agent (required connection)
    @link
    class _:
        source = ("node:llm_model:gpt4", "output")
        target = ("node:langchain_agent:assistant", "llm")

    # Agent response → Chat (loop back)
    @link
    class _:
        source = ("node:langchain_agent:assistant", "output")
        target = ("node:trigger:chat:main", "response")
    
    return "Chat workflow active"
